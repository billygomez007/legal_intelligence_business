-- =============================================================================
-- Legal Retrieval sessions and immutable evidence history
-- =============================================================================
--
-- Purpose:
--
--   Persist privacy-safe provenance for authorized legal retrieval.
--
-- Stored:
--
--   * tenant / task / task-scope identity;
--   * Ghana jurisdiction identity;
--   * optional matter identity;
--   * retrieval scope mode;
--   * normalized-query SHA-256 fingerprint;
--   * requested limit and final result count;
--   * exact source / version / passage / locator / content-hash provenance.
--
-- Explicitly NOT stored:
--
--   * raw query text;
--   * normalized query text;
--   * excerpts;
--   * private document content;
--   * Work Product content.
--
-- Session and evidence rows are immutable append-only history.

CREATE SCHEMA IF NOT EXISTS legal_retrieval;

REVOKE ALL
  ON SCHEMA legal_retrieval
  FROM PUBLIC;

GRANT USAGE
  ON SCHEMA legal_retrieval
  TO legalintel_app;

CREATE TABLE legal_retrieval.sessions (
  organization_id     uuid        NOT NULL,
  id                  uuid        NOT NULL,
  task_id             uuid        NOT NULL,
  task_scope_revision integer     NOT NULL,
  jurisdiction_id     uuid        NOT NULL,
  matter_id           uuid        NULL,
  scope_mode          text        NOT NULL,
  query_fingerprint   text        NOT NULL,
  requested_limit     integer     NOT NULL,
  result_count        integer     NOT NULL,
  created_by          uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT legal_retrieval_sessions_pkey
    PRIMARY KEY (
      organization_id,
      id
    ),

  CONSTRAINT legal_retrieval_sessions_organization_fk
    FOREIGN KEY (
      organization_id
    )
    REFERENCES iam.organizations(id),

  CONSTRAINT legal_retrieval_sessions_creator_fk
    FOREIGN KEY (
      created_by
    )
    REFERENCES iam.users(id),

  CONSTRAINT legal_retrieval_sessions_scope_revision_valid
    CHECK (
      task_scope_revision >= 1
    ),

  CONSTRAINT legal_retrieval_sessions_scope_mode_valid
    CHECK (
      scope_mode IN (
        'ghana_corpus',
        'ghana_corpus_and_firm_knowledge',
        'ghana_corpus_and_matter',
        'ghana_corpus_and_matter_and_firm_knowledge'
      )
    ),

  CONSTRAINT legal_retrieval_sessions_query_fingerprint_valid
    CHECK (
      query_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  CONSTRAINT legal_retrieval_sessions_requested_limit_valid
    CHECK (
      requested_limit BETWEEN 1 AND 50
    ),

  CONSTRAINT legal_retrieval_sessions_result_count_valid
    CHECK (
      result_count BETWEEN 0 AND 50
      AND result_count <= requested_limit
    )
);

CREATE INDEX legal_retrieval_sessions_task_idx
  ON legal_retrieval.sessions (
    organization_id,
    task_id,
    task_scope_revision,
    created_at DESC,
    id
  );

CREATE INDEX legal_retrieval_sessions_matter_idx
  ON legal_retrieval.sessions (
    organization_id,
    matter_id,
    created_at DESC,
    id
  )
  WHERE matter_id IS NOT NULL;

CREATE TABLE legal_retrieval.session_evidence (
  organization_id uuid        NOT NULL,
  session_id      uuid        NOT NULL,
  ordinal         integer     NOT NULL,
  source_kind     text        NOT NULL,
  source_id       uuid        NOT NULL,
  version_id      uuid        NOT NULL,
  passage_id      uuid        NULL,
  locator         text        NULL,
  content_sha256  text        NULL,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT legal_retrieval_session_evidence_pkey
    PRIMARY KEY (
      organization_id,
      session_id,
      ordinal
    ),

  CONSTRAINT legal_retrieval_session_evidence_session_fk
    FOREIGN KEY (
      organization_id,
      session_id
    )
    REFERENCES legal_retrieval.sessions (
      organization_id,
      id
    ),

  CONSTRAINT legal_retrieval_session_evidence_ordinal_valid
    CHECK (
      ordinal >= 0
      AND ordinal < 50
    ),

  CONSTRAINT legal_retrieval_session_evidence_source_kind_valid
    CHECK (
      source_kind IN (
        'corpus_document_version',
        'knowledge_source_version',
        'matter_document_version'
      )
    ),

  CONSTRAINT legal_retrieval_session_evidence_locator_valid
    CHECK (
      locator IS NULL
      OR (
        length(locator) BETWEEN 1 AND 512
        AND locator = btrim(locator)
      )
    ),

  CONSTRAINT legal_retrieval_session_evidence_hash_valid
    CHECK (
      content_sha256 IS NULL
      OR content_sha256 ~ '^[0-9a-f]{64}$'
    )
);

CREATE INDEX legal_retrieval_session_evidence_source_idx
  ON legal_retrieval.session_evidence (
    organization_id,
    source_kind,
    source_id,
    version_id
  );

CREATE INDEX legal_retrieval_session_evidence_passage_idx
  ON legal_retrieval.session_evidence (
    organization_id,
    passage_id
  )
  WHERE passage_id IS NOT NULL;

CALL app.enable_tenant_rls(
  'legal_retrieval.sessions'::regclass
);

CALL app.enable_tenant_rls(
  'legal_retrieval.session_evidence'::regclass
);

REVOKE ALL
  ON legal_retrieval.sessions
  FROM PUBLIC;

REVOKE ALL
  ON legal_retrieval.session_evidence
  FROM PUBLIC;

GRANT SELECT, INSERT
  ON legal_retrieval.sessions
  TO legalintel_app;

GRANT SELECT, INSERT
  ON legal_retrieval.session_evidence
  TO legalintel_app;

CREATE FUNCTION legal_retrieval.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'legal retrieval history is immutable'
    USING ERRCODE = '42501',
          HINT = 'legal_retrieval.immutable_history';
END
$$;

REVOKE ALL
  ON FUNCTION legal_retrieval.reject_immutable_change()
  FROM PUBLIC;

CREATE TRIGGER legal_retrieval_sessions_immutable
BEFORE UPDATE OR DELETE
ON legal_retrieval.sessions
FOR EACH ROW
EXECUTE FUNCTION legal_retrieval.reject_immutable_change();

CREATE TRIGGER legal_retrieval_session_evidence_immutable
BEFORE UPDATE OR DELETE
ON legal_retrieval.session_evidence
FOR EACH ROW
EXECUTE FUNCTION legal_retrieval.reject_immutable_change();

COMMENT ON TABLE legal_retrieval.sessions IS
  'Tenant-scoped immutable legal retrieval sessions. Raw query text is deliberately not persisted.';

COMMENT ON COLUMN legal_retrieval.sessions.query_fingerprint IS
  'SHA-256 fingerprint of the normalized retrieval query; not the query text.';

COMMENT ON TABLE legal_retrieval.session_evidence IS
  'Immutable exact evidence provenance for a retrieval session; contains identifiers and hashes, never excerpts.';
