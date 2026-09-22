-- =============================================================================
-- Firm Knowledge immutable private passage index
-- =============================================================================
--
-- Firm Knowledge source versions intentionally remain immutable file/version
-- records. This forward migration adds an independently immutable textual
-- evidence index used by authorized legal retrieval.
--
-- Security properties:
--
--   * every row is tenant owned;
--   * FORCE RLS is installed through app.enable_tenant_rls;
--   * passages can only reference an exact version belonging to the same
--     source and organization;
--   * runtime users may SELECT and INSERT but never UPDATE, DELETE or TRUNCATE;
--   * an immutable trigger also rejects mutation through privileged paths;
--   * text identity is bound to SHA-256 at the database boundary;
--   * lexical search is local PostgreSQL full-text search;
--   * storage keys and original files are not copied into the index.
--
-- This table does not itself decide whether a source is currently usable.
-- Retrieval must still join knowledge.sources and require status = 'active',
-- and Phase 7 reauthorizes the exact source/version before evidence is used.

ALTER TABLE knowledge.source_versions
  ADD CONSTRAINT knowledge_source_versions_source_identity_unique
  UNIQUE (organization_id, source_id, id);

CREATE TABLE knowledge.passages (
  organization_id uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  source_id       uuid        NOT NULL,
  version_id      uuid        NOT NULL,
  ordinal         integer     NOT NULL,
  locator         text,
  text            text        NOT NULL,
  text_sha256     text        NOT NULL,
  search_vector   tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT knowledge_passages_pkey
    PRIMARY KEY (organization_id, id),

  CONSTRAINT knowledge_passages_exact_version_fkey
    FOREIGN KEY (organization_id, source_id, version_id)
    REFERENCES knowledge.source_versions (
      organization_id,
      source_id,
      id
    ),

  CONSTRAINT knowledge_passages_version_ordinal_unique
    UNIQUE (organization_id, version_id, ordinal),

  CONSTRAINT knowledge_passages_ordinal_nonnegative
    CHECK (ordinal >= 0 AND ordinal < 100000),

  CONSTRAINT knowledge_passages_locator_valid
    CHECK (
      locator IS NULL
      OR (
        length(locator) BETWEEN 1 AND 512
        AND locator = btrim(locator)
      )
    ),

  CONSTRAINT knowledge_passages_text_valid
    CHECK (
      length(text) > 0
      AND octet_length(text) <= 1048576
    ),

  CONSTRAINT knowledge_passages_sha256_format
    CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT knowledge_passages_sha256_matches
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

CREATE INDEX knowledge_passages_version_idx
  ON knowledge.passages (
    organization_id,
    source_id,
    version_id,
    ordinal
  );

CREATE INDEX knowledge_passages_search_idx
  ON knowledge.passages
  USING gin (search_vector);

CALL app.enable_tenant_rls(
  'knowledge.passages'::regclass
);

REVOKE ALL
  ON knowledge.passages
  FROM PUBLIC;

GRANT SELECT, INSERT
  ON knowledge.passages
  TO legalintel_app;

CREATE FUNCTION knowledge.reject_passage_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'firm knowledge passage evidence is immutable'
    USING ERRCODE = '42501',
          HINT = 'knowledge.immutable_passage';
END
$$;

REVOKE ALL
  ON FUNCTION knowledge.reject_passage_mutation()
  FROM PUBLIC;

CREATE TRIGGER knowledge_passages_immutable
BEFORE UPDATE OR DELETE
ON knowledge.passages
FOR EACH ROW
EXECUTE FUNCTION knowledge.reject_passage_mutation();

COMMENT ON TABLE knowledge.passages IS
  'Tenant-scoped immutable text passages for exact Firm Knowledge source versions.';

COMMENT ON COLUMN knowledge.passages.text_sha256 IS
  'Hex SHA-256 of the UTF-8 passage text, checked by PostgreSQL.';

COMMENT ON COLUMN knowledge.passages.search_vector IS
  'Generated PostgreSQL simple-language full-text vector; never supplied by a client.';
