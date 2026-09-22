-- =============================================================================
-- Matter Document immutable private passage index
-- =============================================================================
--
-- Matter Documents contain confidential matter-scoped files. Search evidence
-- therefore carries the organization, matter, document and immutable version
-- identity directly on every indexed passage.
--
-- Security properties:
--
--   * every row is tenant owned and FORCE-RLS protected;
--   * every passage belongs to one exact matter/document/version tuple;
--   * a passage cannot be attached to a version from another matter;
--   * runtime users receive only SELECT and INSERT;
--   * UPDATE/DELETE are rejected by both privileges and trigger;
--   * passage text is cryptographically bound to its SHA-256;
--   * PostgreSQL full-text search stays inside the tenant transaction;
--   * retrieval must constrain matter_id before ranking.
--
-- Current task scope remains authoritative. Merely finding a matching passage
-- never grants access: Phase 7 reauthorizes matter, document and exact version
-- again before retrieved evidence may enter a Work Product revision.

ALTER TABLE matter_documents.document_versions
  ADD CONSTRAINT matter_document_versions_exact_identity_unique
  UNIQUE (
    organization_id,
    matter_id,
    document_id,
    id
  );

CREATE TABLE matter_documents.passages (
  organization_id uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  matter_id       uuid        NOT NULL,
  document_id     uuid        NOT NULL,
  version_id      uuid        NOT NULL,
  ordinal         integer     NOT NULL,
  locator         text,
  text            text        NOT NULL,
  text_sha256     text        NOT NULL,
  search_vector   tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT matter_document_passages_pkey
    PRIMARY KEY (organization_id, id),

  CONSTRAINT matter_document_passages_exact_version_fkey
    FOREIGN KEY (
      organization_id,
      matter_id,
      document_id,
      version_id
    )
    REFERENCES matter_documents.document_versions (
      organization_id,
      matter_id,
      document_id,
      id
    ),

  CONSTRAINT matter_document_passages_version_ordinal_unique
    UNIQUE (organization_id, version_id, ordinal),

  CONSTRAINT matter_document_passages_ordinal_nonnegative
    CHECK (ordinal >= 0 AND ordinal < 100000),

  CONSTRAINT matter_document_passages_locator_valid
    CHECK (
      locator IS NULL
      OR (
        length(locator) BETWEEN 1 AND 512
        AND locator = btrim(locator)
      )
    ),

  CONSTRAINT matter_document_passages_text_valid
    CHECK (
      length(text) > 0
      AND octet_length(text) <= 1048576
    ),

  CONSTRAINT matter_document_passages_sha256_format
    CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT matter_document_passages_sha256_matches
    CHECK (
      text_sha256 =
      encode(
        sha256(
          convert_to(text, 'UTF8')
        ),
        'hex'
      )
    )
);

CREATE INDEX matter_document_passages_version_idx
  ON matter_documents.passages (
    organization_id,
    matter_id,
    document_id,
    version_id,
    ordinal
  );

CREATE INDEX matter_document_passages_search_idx
  ON matter_documents.passages
  USING gin (search_vector);

CALL app.enable_tenant_rls(
  'matter_documents.passages'::regclass
);

REVOKE ALL
  ON matter_documents.passages
  FROM PUBLIC;

GRANT SELECT, INSERT
  ON matter_documents.passages
  TO legalintel_app;

CREATE FUNCTION matter_documents.reject_passage_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'matter document passage evidence is immutable'
    USING ERRCODE = '42501',
          HINT = 'matter_documents.immutable_passage';
END
$$;

REVOKE ALL
  ON FUNCTION matter_documents.reject_passage_mutation()
  FROM PUBLIC;

CREATE TRIGGER matter_document_passages_immutable
BEFORE UPDATE OR DELETE
ON matter_documents.passages
FOR EACH ROW
EXECUTE FUNCTION matter_documents.reject_passage_mutation();

COMMENT ON TABLE matter_documents.passages IS
  'Tenant- and matter-scoped immutable text passages for exact Matter Document versions.';

COMMENT ON COLUMN matter_documents.passages.text_sha256 IS
  'Hex SHA-256 of UTF-8 passage text, checked by PostgreSQL.';

COMMENT ON COLUMN matter_documents.passages.search_vector IS
  'Generated PostgreSQL simple-language full-text vector used only after tenant/matter filtering.';
