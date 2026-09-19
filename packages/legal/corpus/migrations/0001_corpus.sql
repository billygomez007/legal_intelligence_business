-- The legal corpus: jurisdictions, courts, source-rights register, documents, versions,
-- passages and the citation graph. Design: docs/adr/0006-legal-corpus-provenance-and-rights.md.
--
-- This data is SHARED, not tenant-owned. Instead of tenant RLS, access is governed by:
--   * roles: ingest writes drafts, dataops reviews and publishes, app only reads;
--   * lifecycle: the app role sees a version only while it is PUBLISHED;
--   * rights: and only while its source's CURRENT rights decision allows display. Rights are
--     checked at read time, so revoking a source hides its content immediately.

CREATE SCHEMA corpus;
CREATE SCHEMA graph;

CREATE FUNCTION corpus.reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'records in %.% are append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501', HINT = 'corpus.append_only';
END
$$;

-- ---------------------------------------------------------------------------------------
-- Jurisdiction is a first-class, mandatory concept.
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.jurisdictions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
  name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  kind         text        NOT NULL CHECK (kind IN ('country', 'supranational', 'region')),
  parent_id    uuid        REFERENCES corpus.jurisdictions (id),
  -- Synthetic jurisdictions hold test fixtures. Services refuse to start in production if any
  -- exists, so fabricated authority can never silently reach users.
  is_synthetic boolean     NOT NULL DEFAULT false,
  config       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE corpus.courts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id    uuid        NOT NULL REFERENCES corpus.jurisdictions (id),
  name               text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  level              smallint    NOT NULL CHECK (level >= 1),
  -- 1 = highest authority within its jurisdiction. Drives "does this bind that court".
  authority_rank     smallint    NOT NULL CHECK (authority_rank >= 1),
  appeal_to_court_id uuid        REFERENCES corpus.courts (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction_id, name),
  UNIQUE (id, jurisdiction_id),
  CHECK (appeal_to_court_id IS NULL OR appeal_to_court_id <> id)
);

CREATE TABLE corpus.court_lineage (
  predecessor_id uuid NOT NULL REFERENCES corpus.courts (id),
  successor_id   uuid NOT NULL REFERENCES corpus.courts (id),
  effective_from date NOT NULL,
  PRIMARY KEY (predecessor_id, successor_id),
  CHECK (predecessor_id <> successor_id)
);

-- ---------------------------------------------------------------------------------------
-- Source register and the append-only rights ledger (docs/18: track provenance and rights).
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.sources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid        NOT NULL REFERENCES corpus.jurisdictions (id),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  kind            text        NOT NULL CHECK (kind IN (
                    'court_registry', 'government_gazette', 'legislature', 'publisher',
                    'institutional_repository', 'user_supplied')),
  reference       text        CHECK (length(reference) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction_id, name),
  UNIQUE (id, jurisdiction_id)
);

CREATE TABLE corpus.source_rights_decisions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Strict insertion order. The ledger is ordered by this, never by a timestamp: two decisions
  -- can share a clock reading (or arrive from machines with skewed clocks), and "which
  -- decision is latest" decides whether a source's content may be shown at all.
  sequence          bigint      GENERATED ALWAYS AS IDENTITY,
  source_id         uuid        NOT NULL REFERENCES corpus.sources (id),
  status            text        NOT NULL CHECK (status IN ('approved', 'denied', 'revoked')),
  -- Uses are distinct: permission to display is not permission to feed a model or an API.
  allowed_uses      text[]      NOT NULL DEFAULT '{}'
                    CHECK (allowed_uses <@ ARRAY['display', 'index_search', 'ai_processing',
                           'derive_metadata', 'redistribute_api', 'bulk_export']::text[]),
  restrictions      text        CHECK (length(restrictions) <= 2000),
  -- Where the permission comes from: a licence, letter or counsel sign-off reference.
  evidence_reference text       CHECK (length(evidence_reference) <= 500),
  decided_by        uuid        NOT NULL REFERENCES iam.users (id),
  decided_at        timestamptz NOT NULL DEFAULT now(),
  effective_from    timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  CHECK (status <> 'approved'
         OR (cardinality(allowed_uses) > 0 AND length(trim(coalesce(evidence_reference, ''))) > 0)),
  CHECK (status = 'approved' OR cardinality(allowed_uses) = 0),
  CHECK (expires_at IS NULL OR expires_at > effective_from)
);
CREATE INDEX source_rights_decisions_lookup_idx
  ON corpus.source_rights_decisions (source_id, sequence DESC);
CREATE TRIGGER rights_no_update BEFORE UPDATE ON corpus.source_rights_decisions
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER rights_no_delete BEFORE DELETE ON corpus.source_rights_decisions
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER rights_no_truncate BEFORE TRUNCATE ON corpus.source_rights_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

-- May the platform do `p_use` with content from this source RIGHT NOW? The latest decision
-- that has taken effect wins; a revocation, denial or expiry means no. SECURITY DEFINER so the
-- application can ask the question without being able to read the register itself.
CREATE FUNCTION corpus.source_allows(p_source uuid, p_use text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((
    SELECT d.status = 'approved'
           AND p_use = ANY (d.allowed_uses)
           AND (d.expires_at IS NULL OR d.expires_at > now())
      FROM corpus.source_rights_decisions d
     WHERE d.source_id = p_source AND d.effective_from <= now()
     ORDER BY d.sequence DESC
     LIMIT 1
  ), false)
$$;

-- ---------------------------------------------------------------------------------------
-- Works and their metadata. Jurisdiction consistency is structural: composite foreign keys
-- make it impossible to attach a Ghanaian court to a document of another jurisdiction.
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.legal_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid        NOT NULL REFERENCES corpus.jurisdictions (id),
  document_type   text        NOT NULL CHECK (document_type IN (
                    'case', 'legislation', 'regulation', 'court_rule',
                    'practice_direction', 'treaty', 'gazette_notice', 'commentary')),
  title           text        NOT NULL CHECK (length(title) BETWEEN 1 AND 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, jurisdiction_id)
);
CREATE INDEX legal_documents_jurisdiction_type_idx
  ON corpus.legal_documents (jurisdiction_id, document_type);

CREATE TABLE corpus.case_details (
  document_id        uuid PRIMARY KEY,
  jurisdiction_id    uuid NOT NULL,
  court_id           uuid NOT NULL,
  decision_date      date,
  neutral_citation   text CHECK (length(neutral_citation) <= 200),
  docket_number      text CHECK (length(docket_number) <= 200),
  procedural_posture text CHECK (length(procedural_posture) <= 500),
  FOREIGN KEY (document_id, jurisdiction_id) REFERENCES corpus.legal_documents (id, jurisdiction_id),
  FOREIGN KEY (court_id, jurisdiction_id) REFERENCES corpus.courts (id, jurisdiction_id)
);

CREATE TABLE corpus.legislation_details (
  document_id       uuid PRIMARY KEY REFERENCES corpus.legal_documents (id),
  instrument_type   text CHECK (length(instrument_type) <= 100),
  instrument_number text CHECK (length(instrument_number) <= 100),
  enactment_date    date,
  commencement_date date,
  repeal_status     text NOT NULL DEFAULT 'unknown'
                    CHECK (repeal_status IN ('in_force', 'repealed', 'partially_repealed', 'unknown'))
);

-- ---------------------------------------------------------------------------------------
-- Versions: an immutable acquisition of a work, with provenance and a lifecycle.
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.lifecycle_transitions (
  from_state text NOT NULL,
  to_state   text NOT NULL,
  PRIMARY KEY (from_state, to_state)
);
INSERT INTO corpus.lifecycle_transitions (from_state, to_state) VALUES
  ('ingesting', 'pending_review'),
  ('ingesting', 'rejected'),
  ('pending_review', 'approved'),
  ('pending_review', 'rejected'),
  ('approved', 'published'),
  ('approved', 'rejected'),
  ('published', 'withdrawn');

CREATE TABLE corpus.document_versions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid        NOT NULL,
  jurisdiction_id       uuid        NOT NULL,
  version_number        integer     NOT NULL CHECK (version_number >= 1),
  source_id             uuid        NOT NULL,
  source_reference      text        CHECK (length(source_reference) <= 2000),
  acquired_at           timestamptz NOT NULL,
  content_checksum      bytea       NOT NULL CHECK (length(content_checksum) = 32),
  storage_key           text        NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 1024),
  pipeline_version      text        NOT NULL CHECK (length(pipeline_version) BETWEEN 1 AND 64),
  language              text        NOT NULL DEFAULT 'en' CHECK (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  lifecycle_state       text        NOT NULL DEFAULT 'ingesting' CHECK (lifecycle_state IN (
                          'ingesting', 'pending_review', 'approved', 'published', 'withdrawn', 'rejected')),
  supersedes_version_id uuid        REFERENCES corpus.document_versions (id),
  approved_by           uuid        REFERENCES iam.users (id),
  approved_at           timestamptz,
  published_by          uuid        REFERENCES iam.users (id),
  published_at          timestamptz,
  withdrawn_at          timestamptz,
  withdrawal_reason     text        CHECK (length(withdrawal_reason) <= 1000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number),
  -- The same bytes cannot become two versions of one work (deduplication, doc 14).
  UNIQUE (document_id, content_checksum),
  FOREIGN KEY (document_id, jurisdiction_id) REFERENCES corpus.legal_documents (id, jurisdiction_id),
  FOREIGN KEY (source_id, jurisdiction_id) REFERENCES corpus.sources (id, jurisdiction_id),
  CHECK (lifecycle_state NOT IN ('approved', 'published', 'withdrawn') OR approved_by IS NOT NULL),
  CHECK (lifecycle_state NOT IN ('published', 'withdrawn')
         OR (published_by IS NOT NULL AND published_at IS NOT NULL)),
  -- Two-person rule: whoever approved a version cannot also publish it.
  CONSTRAINT two_person_rule CHECK (published_by IS NULL OR published_by <> approved_by),
  CHECK (lifecycle_state <> 'withdrawn' OR (withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL))
);
CREATE INDEX document_versions_document_idx ON corpus.document_versions (document_id, version_number DESC);
CREATE INDEX document_versions_published_idx ON corpus.document_versions (document_id)
  WHERE lifecycle_state = 'published';
CREATE INDEX document_versions_source_idx ON corpus.document_versions (source_id);

CREATE FUNCTION corpus.enforce_version_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_state <> 'ingesting'
       OR NEW.approved_by IS NOT NULL OR NEW.published_by IS NOT NULL THEN
      RAISE EXCEPTION 'a version must be created in the ingesting state'
        USING ERRCODE = 'P0001', HINT = 'corpus.invalid_creation';
    END IF;
    RETURN NEW;
  END IF;

  -- Provenance and content identity never change after creation. Corrections are new versions.
  IF NEW.document_id <> OLD.document_id OR NEW.jurisdiction_id <> OLD.jurisdiction_id
     OR NEW.version_number <> OLD.version_number OR NEW.source_id <> OLD.source_id
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.acquired_at <> OLD.acquired_at OR NEW.content_checksum <> OLD.content_checksum
     OR NEW.storage_key <> OLD.storage_key OR NEW.pipeline_version <> OLD.pipeline_version
     OR NEW.language <> OLD.language
     OR NEW.supersedes_version_id IS DISTINCT FROM OLD.supersedes_version_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'version provenance is immutable; publish a new version instead'
      USING ERRCODE = 'P0001', HINT = 'corpus.version_immutable';
  END IF;

  IF NEW.lifecycle_state = OLD.lifecycle_state THEN
    RAISE EXCEPTION 'a version cannot be modified without a lifecycle transition'
      USING ERRCODE = 'P0001', HINT = 'corpus.version_immutable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM corpus.lifecycle_transitions t
     WHERE t.from_state = OLD.lifecycle_state AND t.to_state = NEW.lifecycle_state
  ) THEN
    RAISE EXCEPTION 'cannot move a version from % to %', OLD.lifecycle_state, NEW.lifecycle_state
      USING ERRCODE = 'P0001', HINT = 'corpus.invalid_transition';
  END IF;

  IF NEW.lifecycle_state = 'approved' THEN
    NEW.approved_at := coalesce(NEW.approved_at, now());
  END IF;

  IF NEW.lifecycle_state = 'published' THEN
    -- The rights gate. Being technically accessible is not being approved (docs/14).
    IF NOT (corpus.source_allows(NEW.source_id, 'display')
            AND corpus.source_allows(NEW.source_id, 'index_search')) THEN
      RAISE EXCEPTION 'the source has no current rights decision allowing display and search'
        USING ERRCODE = 'P0001', HINT = 'corpus.rights_not_cleared';
    END IF;
    NEW.published_at := coalesce(NEW.published_at, now());
  END IF;

  IF NEW.lifecycle_state = 'withdrawn' THEN
    NEW.withdrawn_at := coalesce(NEW.withdrawn_at, now());
  END IF;

  RETURN NEW;
END
$$;
CREATE TRIGGER versions_lifecycle BEFORE INSERT OR UPDATE ON corpus.document_versions
  FOR EACH ROW EXECUTE FUNCTION corpus.enforce_version_lifecycle();

-- Nothing is deleted from the corpus: withdrawal is a state, not a DELETE.
CREATE TRIGGER versions_no_delete BEFORE DELETE ON corpus.document_versions
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER versions_no_truncate BEFORE TRUNCATE ON corpus.document_versions
  FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

-- ---------------------------------------------------------------------------------------
-- Passages: the citable unit. Text is frozen once the version leaves `ingesting`.
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.passages (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id            uuid          NOT NULL REFERENCES corpus.document_versions (id),
  ordinal               integer       NOT NULL CHECK (ordinal >= 0),
  locator               text          NOT NULL CHECK (length(locator) BETWEEN 1 AND 200),
  text                  text          NOT NULL CHECK (length(text) BETWEEN 1 AND 100000),
  -- The database verifies the hash, so a corrupted or mismatched write cannot be stored.
  text_sha256           bytea         NOT NULL
                        CONSTRAINT passage_hash_matches CHECK (text_sha256 = sha256(convert_to(text, 'UTF8'))),
  extraction_confidence numeric(4, 3) CHECK (extraction_confidence BETWEEN 0 AND 1),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (version_id, ordinal),
  UNIQUE (id, version_id)
);

CREATE FUNCTION corpus.enforce_passages_frozen() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  SELECT lifecycle_state INTO v_state
    FROM corpus.document_versions
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;

  IF v_state IS DISTINCT FROM 'ingesting' THEN
    RAISE EXCEPTION 'passages are frozen once a version leaves ingestion'
      USING ERRCODE = 'P0001', HINT = 'corpus.passages_frozen';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER passages_frozen BEFORE INSERT OR UPDATE OR DELETE ON corpus.passages
  FOR EACH ROW EXECUTE FUNCTION corpus.enforce_passages_frozen();

-- ---------------------------------------------------------------------------------------
-- The citation graph. An edge is only ever an assertion about evidence in the text.
-- ---------------------------------------------------------------------------------------
CREATE TABLE graph.relationship_types (
  type            text    PRIMARY KEY,
  -- High-impact treatments must be human-reviewed before end users see them (docs/13, 19).
  requires_review boolean NOT NULL
);
INSERT INTO graph.relationship_types (type, requires_review) VALUES
  ('cites', false), ('mentions', false),
  ('followed', true), ('applied', true), ('distinguished', true), ('questioned', true),
  ('overruled', true), ('interprets', true), ('applies_provision', true),
  ('amends', true), ('repeals', true), ('supersedes', true);

CREATE TABLE graph.citations (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  from_version_id     uuid          NOT NULL REFERENCES corpus.document_versions (id),
  to_document_id      uuid          NOT NULL REFERENCES corpus.legal_documents (id),
  relationship_type   text          NOT NULL REFERENCES graph.relationship_types (type),
  citation_text       text          NOT NULL CHECK (length(citation_text) BETWEEN 1 AND 500),
  -- Traceability: the passage IN THE CITING VERSION that supports this edge.
  evidence_passage_id uuid          NOT NULL,
  origin              text          NOT NULL CHECK (origin IN ('machine', 'human')),
  confidence          numeric(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  review_status       text          NOT NULL DEFAULT 'unreviewed'
                                    CHECK (review_status IN ('unreviewed', 'human_reviewed', 'rejected')),
  reviewed_by         uuid          REFERENCES iam.users (id),
  reviewed_at         timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  -- The evidence must belong to the citing version, not merely exist somewhere.
  FOREIGN KEY (evidence_passage_id, from_version_id) REFERENCES corpus.passages (id, version_id),
  CHECK (origin = 'human' OR confidence IS NOT NULL),
  CHECK (review_status = 'unreviewed' OR reviewed_by IS NOT NULL),
  UNIQUE (from_version_id, to_document_id, relationship_type, evidence_passage_id)
);
CREATE INDEX citations_to_document_idx ON graph.citations (to_document_id);
CREATE INDEX citations_from_version_idx ON graph.citations (from_version_id);

-- ---------------------------------------------------------------------------------------
-- Row-level security. The application sees only published, currently rights-cleared content.
-- Policies nest (a passage is visible iff its version is), and the subqueries are themselves
-- subject to the invoker's policies, so a rule lives in exactly one place.
-- ---------------------------------------------------------------------------------------
ALTER TABLE corpus.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus.document_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY app_read ON corpus.document_versions FOR SELECT TO legalintel_app
  USING (lifecycle_state = 'published' AND corpus.source_allows(source_id, 'display'));

CREATE POLICY staff_read ON corpus.document_versions FOR SELECT TO legalintel_ingest, legalintel_dataops
  USING (true);
-- Ingestion creates drafts and may hand them to review or reject them. It can never approve
-- or publish: those states are outside its WITH CHECK.
CREATE POLICY ingest_insert ON corpus.document_versions FOR INSERT TO legalintel_ingest
  WITH CHECK (lifecycle_state = 'ingesting');
CREATE POLICY ingest_update ON corpus.document_versions FOR UPDATE TO legalintel_ingest
  USING (lifecycle_state = 'ingesting')
  WITH CHECK (lifecycle_state IN ('pending_review', 'rejected'));
-- Data-ops reviews and publishes. It cannot create versions.
CREATE POLICY dataops_update ON corpus.document_versions FOR UPDATE TO legalintel_dataops
  USING (lifecycle_state IN ('pending_review', 'approved', 'published'))
  WITH CHECK (lifecycle_state IN ('approved', 'rejected', 'published', 'withdrawn'));

ALTER TABLE corpus.passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus.passages FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON corpus.passages FOR SELECT TO legalintel_app
  USING (EXISTS (SELECT 1 FROM corpus.document_versions v WHERE v.id = passages.version_id));
CREATE POLICY staff_read ON corpus.passages FOR SELECT TO legalintel_ingest, legalintel_dataops
  USING (true);
CREATE POLICY ingest_write ON corpus.passages FOR ALL TO legalintel_ingest
  USING (true) WITH CHECK (true);

ALTER TABLE corpus.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus.legal_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON corpus.legal_documents FOR SELECT TO legalintel_app
  USING (EXISTS (SELECT 1 FROM corpus.document_versions v WHERE v.document_id = legal_documents.id));
CREATE POLICY staff_read ON corpus.legal_documents FOR SELECT TO legalintel_ingest, legalintel_dataops
  USING (true);
CREATE POLICY ingest_write ON corpus.legal_documents FOR INSERT TO legalintel_ingest WITH CHECK (true);
CREATE POLICY dataops_write ON corpus.legal_documents FOR UPDATE TO legalintel_dataops
  USING (true) WITH CHECK (true);

ALTER TABLE corpus.case_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus.case_details FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON corpus.case_details FOR SELECT TO legalintel_app
  USING (EXISTS (SELECT 1 FROM corpus.document_versions v WHERE v.document_id = case_details.document_id));
CREATE POLICY staff_all ON corpus.case_details FOR ALL TO legalintel_ingest, legalintel_dataops
  USING (true) WITH CHECK (true);

ALTER TABLE corpus.legislation_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus.legislation_details FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON corpus.legislation_details FOR SELECT TO legalintel_app
  USING (EXISTS (SELECT 1 FROM corpus.document_versions v WHERE v.document_id = legislation_details.document_id));
CREATE POLICY staff_all ON corpus.legislation_details FOR ALL TO legalintel_ingest, legalintel_dataops
  USING (true) WITH CHECK (true);

ALTER TABLE graph.citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph.citations FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON graph.citations FOR SELECT TO legalintel_app
  USING (
    review_status <> 'rejected'
    AND EXISTS (
      SELECT 1 FROM graph.relationship_types rt
       WHERE rt.type = citations.relationship_type
         AND (NOT rt.requires_review OR citations.review_status = 'human_reviewed')
    )
    AND EXISTS (SELECT 1 FROM corpus.document_versions f WHERE f.id = citations.from_version_id)
    AND EXISTS (SELECT 1 FROM corpus.document_versions t WHERE t.document_id = citations.to_document_id)
  );
CREATE POLICY staff_read ON graph.citations FOR SELECT TO legalintel_ingest, legalintel_dataops
  USING (true);
-- Machine extraction proposes edges; it cannot mark them reviewed.
CREATE POLICY ingest_insert ON graph.citations FOR INSERT TO legalintel_ingest
  WITH CHECK (origin = 'machine' AND review_status = 'unreviewed');
CREATE POLICY dataops_insert ON graph.citations FOR INSERT TO legalintel_dataops
  WITH CHECK (origin = 'human');
CREATE POLICY dataops_review ON graph.citations FOR UPDATE TO legalintel_dataops
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------------------
-- Privileges: explicit and minimal. Never TRUNCATE, TRIGGER or REFERENCES.
-- ---------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA corpus, graph TO legalintel_app, legalintel_ingest, legalintel_dataops;

GRANT EXECUTE ON FUNCTION corpus.source_allows(uuid, text)
  TO legalintel_app, legalintel_ingest, legalintel_dataops;

-- Public reference data: readable by all runtime roles, curated by data-ops.
GRANT SELECT ON corpus.jurisdictions, corpus.courts, corpus.court_lineage TO
  legalintel_app, legalintel_ingest, legalintel_dataops;
GRANT INSERT ON corpus.jurisdictions, corpus.courts, corpus.court_lineage TO legalintel_dataops;
GRANT SELECT ON graph.relationship_types TO legalintel_app, legalintel_ingest, legalintel_dataops;

-- Sources: provenance the user is shown (who published this), not the rights ledger.
GRANT SELECT (id, jurisdiction_id, name, kind, reference) ON corpus.sources TO legalintel_app;
GRANT SELECT ON corpus.sources TO legalintel_ingest, legalintel_dataops;
GRANT INSERT ON corpus.sources TO legalintel_dataops;

-- The rights ledger: data-ops decides, nobody edits. The application never reads it; it asks
-- corpus.source_allows() instead.
GRANT SELECT, INSERT ON corpus.source_rights_decisions TO legalintel_dataops;

GRANT SELECT ON corpus.lifecycle_transitions TO legalintel_ingest, legalintel_dataops;

GRANT SELECT ON corpus.legal_documents TO legalintel_app, legalintel_ingest, legalintel_dataops;
GRANT INSERT ON corpus.legal_documents TO legalintel_ingest;
GRANT UPDATE (title) ON corpus.legal_documents TO legalintel_dataops;

GRANT SELECT ON corpus.case_details, corpus.legislation_details
  TO legalintel_app, legalintel_ingest, legalintel_dataops;
GRANT INSERT, UPDATE ON corpus.case_details, corpus.legislation_details
  TO legalintel_ingest, legalintel_dataops;

-- Versions. The application reads provenance, not internals (storage keys, reviewer identity).
GRANT SELECT (id, document_id, jurisdiction_id, version_number, source_id, source_reference,
              acquired_at, content_checksum, language, lifecycle_state, published_at,
              supersedes_version_id, created_at)
  ON corpus.document_versions TO legalintel_app;
GRANT SELECT ON corpus.document_versions TO legalintel_ingest, legalintel_dataops;
GRANT INSERT ON corpus.document_versions TO legalintel_ingest;
GRANT UPDATE (lifecycle_state) ON corpus.document_versions TO legalintel_ingest;
GRANT UPDATE (lifecycle_state, approved_by, approved_at, published_by, published_at,
              withdrawn_at, withdrawal_reason)
  ON corpus.document_versions TO legalintel_dataops;

GRANT SELECT ON corpus.passages TO legalintel_app, legalintel_ingest, legalintel_dataops;
GRANT INSERT, UPDATE, DELETE ON corpus.passages TO legalintel_ingest;

GRANT SELECT ON graph.citations TO legalintel_app, legalintel_ingest, legalintel_dataops;
GRANT INSERT ON graph.citations TO legalintel_ingest, legalintel_dataops;
GRANT UPDATE (review_status, reviewed_by, reviewed_at) ON graph.citations TO legalintel_dataops;
