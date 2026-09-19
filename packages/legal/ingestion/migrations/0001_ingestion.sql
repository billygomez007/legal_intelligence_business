-- Stage 5: operational records of public-corpus ingestion.
--
-- Scope and ownership (docs/adr/0007-legal-ingestion-boundaries.md):
--   * PUBLIC corpus only. No tenant key or tenant FK exists here, and `corpus.sources` cannot
--     describe private material (corpus migration 0003 removed `user_supplied`).
--   * This migration owns ONLY ingestion tables and functions. It installs no trigger on a
--     corpus table: corpus invariants (rights in force, passage immutability, the review gate
--     on approval) live in the corpus migrations. Ingestion consumes them.
--   * No SECURITY DEFINER function is defined here. Rights are evaluated by
--     corpus.rights_decision_in_force(); ingestion only says which uses its operation needs.
CREATE SCHEMA ingestion;
REVOKE ALL ON SCHEMA ingestion FROM PUBLIC;
GRANT USAGE ON SCHEMA ingestion TO legalintel_ingest, legalintel_dataops;

CREATE TABLE ingestion.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object' AND pg_column_size(request) < 4000),
  request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  operation text NOT NULL CHECK (operation = 'structure'),
  pipeline_version text NOT NULL CHECK (pipeline_version = 'ingestion/1'),
  actor_id uuid NOT NULL REFERENCES iam.users(id),
  correlation_id uuid NOT NULL,
  stage text NOT NULL DEFAULT 'requested' CHECK (stage IN ('requested','acquisition','storage','extraction','parsing','validation','review')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','failed','needs_review','pending_review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  artifact_id uuid,
  version_id uuid REFERENCES corpus.document_versions(id),
  failure_category text CHECK (failure_category IN ('rights_denied','acquisition_failed','integrity_failed',
    'unsupported_format','extraction_failed','extraction_quality_low','parse_failed','metadata_invalid',
    'duplicate_detected','validation_failed','storage_failed','input_invalid','internal_error')),
  failure_summary text CHECK (failure_summary = 'Ingestion stopped: ' || failure_category || '.'),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, idempotency_key),
  FOREIGN KEY (source_id,jurisdiction_id) REFERENCES corpus.sources(id,jurisdiction_id),
  CHECK ((status IN ('failed','needs_review')) = (failure_category IS NOT NULL)),
  CHECK (status <> 'pending_review' OR version_id IS NOT NULL)
);
CREATE INDEX jobs_ready ON ingestion.jobs(next_attempt_at,created_at) WHERE status IN ('queued','running','failed');

CREATE TABLE ingestion.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('text/plain','text/html','application/pdf')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
  -- Millisecond precision on purpose: the version copies this value through application code, and
  -- a JavaScript Date cannot carry microseconds. The database verifies the two are equal.
  acquired_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  input_reference uuid NOT NULL,
  pipeline_version text NOT NULL,
  rights_decision_id uuid NOT NULL REFERENCES corpus.source_rights_decisions(id),
  FOREIGN KEY (source_id,jurisdiction_id) REFERENCES corpus.sources(id,jurisdiction_id),
  UNIQUE(source_id,checksum),
  CHECK(storage_key = 'corpus-' || source_id::text || '-' || checksum)
);
ALTER TABLE ingestion.jobs ADD FOREIGN KEY(artifact_id) REFERENCES ingestion.artifacts(id);

CREATE TABLE ingestion.extractions (
  job_id uuid PRIMARY KEY REFERENCES ingestion.jobs(id),
  artifact_id uuid NOT NULL REFERENCES ingestion.artifacts(id),
  extractor_version text NOT NULL CHECK (length(extractor_version) BETWEEN 1 AND 128),
  text text NOT NULL CHECK (length(text) BETWEEN 20 AND 1000000),
  -- convert_to() is STABLE, so this cannot be a generated column. The database verifies the
  -- hash instead (the same pattern as corpus.passages.text_sha256).
  text_checksum text NOT NULL CHECK (text_checksum ~ '^[a-f0-9]{64}$'
    AND text_checksum = encode(sha256(convert_to(text,'UTF8')),'hex')),
  quality numeric NOT NULL CHECK (quality BETWEEN 0 AND 1),
  warnings text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ingestion.version_evidence (
  version_id uuid PRIMARY KEY REFERENCES corpus.document_versions(id),
  job_id uuid NOT NULL UNIQUE REFERENCES ingestion.extractions(job_id),
  artifact_id uuid NOT NULL REFERENCES ingestion.artifacts(id),
  parser_version text NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 128),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array' AND pg_column_size(fields) < 64000),
  concepts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(concepts) = 'array' AND pg_column_size(concepts) < 64000),
  warnings text[] NOT NULL
);
CREATE TABLE ingestion.passage_evidence (
  passage_id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES ingestion.version_evidence(version_id),
  stable_key text NOT NULL CHECK(stable_key ~ '^[a-f0-9]{64}$'),
  start_offset integer NOT NULL CHECK(start_offset >= 0),
  end_offset integer NOT NULL CHECK(end_offset > start_offset),
  FOREIGN KEY(passage_id,version_id) REFERENCES corpus.passages(id,version_id),
  UNIQUE(version_id,stable_key)
);
CREATE TABLE ingestion.citation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES ingestion.version_evidence(version_id),
  passage_id uuid NOT NULL,
  identifier text NOT NULL CHECK(length(identifier) BETWEEN 1 AND 200),
  quote text NOT NULL CHECK(length(quote) BETWEEN 1 AND 500),
  start_offset integer NOT NULL CHECK(start_offset >= 0),
  end_offset integer NOT NULL CHECK(end_offset > start_offset),
  confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  target_document_id uuid REFERENCES corpus.legal_documents(id),
  graph_citation_id uuid REFERENCES graph.citations(id),
  FOREIGN KEY(passage_id,version_id) REFERENCES corpus.passages(id,version_id),
  UNIQUE(version_id,passage_id,start_offset),
  CHECK((target_document_id IS NULL) = (graph_citation_id IS NULL))
);
CREATE TABLE ingestion.identities (
  source_id uuid NOT NULL REFERENCES corpus.sources(id),
  document_type text NOT NULL CHECK(document_type IN ('case','legislation')),
  identifier text NOT NULL CHECK(length(identifier) BETWEEN 1 AND 1000),
  document_id uuid NOT NULL REFERENCES corpus.legal_documents(id),
  PRIMARY KEY(source_id,document_type,identifier)
);
CREATE TABLE ingestion.review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES ingestion.jobs(id),
  version_id uuid REFERENCES ingestion.version_evidence(version_id),
  reason text NOT NULL CHECK(reason IN ('validation_complete','duplicate_detected','unsupported_format',
    'extraction_quality_low','parse_failed','metadata_invalid')),
  candidate_document_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The disposition of a review task. Several decisions may exist (a hold, then a final one); the
-- first approve or reject closes the task. For a task that carries a version, each decision
-- references the corpus decision that actually moved (or held) the version, so the two records
-- cannot disagree.
CREATE TABLE ingestion.review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  task_id uuid NOT NULL REFERENCES ingestion.review_tasks(id),
  decision text NOT NULL CHECK(decision IN ('approve','reject','hold')),
  actor_id uuid NOT NULL REFERENCES iam.users(id),
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  corpus_decision_id uuid UNIQUE REFERENCES corpus.version_review_decisions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_decisions_task ON ingestion.review_decisions(task_id, sequence);
CREATE TABLE ingestion.stage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES ingestion.jobs(id),
  stage text NOT NULL CHECK(stage IN ('requested','acquisition','storage','extraction','parsing','validation','review')),
  attempt integer NOT NULL CHECK(attempt BETWEEN 0 AND 3),
  duration_ms integer NOT NULL CHECK(duration_ms >= 0),
  outcome text NOT NULL CHECK(outcome IN ('success','error')),
  rights_decision_id uuid REFERENCES corpus.source_rights_decisions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which rights the `structure` operation needs is an ingestion concern; whether they are in
-- force is a corpus concern. SECURITY INVOKER on purpose: it adds no privilege.
CREATE FUNCTION ingestion.current_rights(p_source uuid) RETURNS uuid
LANGUAGE sql
AS $$ SELECT corpus.rights_decision_in_force(p_source, ARRAY['acquire_store', 'derive_metadata']) $$;
REVOKE ALL ON FUNCTION ingestion.current_rights(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ingestion.current_rights(uuid) TO legalintel_ingest, legalintel_dataops;

CREATE FUNCTION ingestion.guard_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM ingestion.current_rights(NEW.source_id);
    IF NEW.status<>'queued' OR NEW.stage<>'requested' OR NEW.attempts<>0 OR NEW.artifact_id IS NOT NULL OR NEW.version_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid initial job state';
    END IF;
    IF NEW.request->>'sourceId' IS DISTINCT FROM NEW.source_id::text OR
       NEW.request->>'jurisdictionId' IS DISTINCT FROM NEW.jurisdiction_id::text OR
       NEW.request->>'actorId' IS DISTINCT FROM NEW.actor_id::text OR
       NEW.request->>'operation' IS DISTINCT FROM NEW.operation OR
       NEW.request ? 'organizationId' OR NEW.request ? 'storageKey' THEN RAISE EXCEPTION 'invalid request scope'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','stage','attempts','artifact_id','version_id','failure_category','failure_summary','next_attempt_at','updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','stage','attempts','artifact_id','version_id','failure_category','failure_summary','next_attempt_at','updated_at']) THEN
    RAISE EXCEPTION 'job identity is immutable';
  END IF;
  IF OLD.status IN ('pending_review','needs_review') THEN RAISE EXCEPTION 'job is terminal'; END IF;
  IF OLD.artifact_id IS NOT NULL AND NEW.artifact_id IS DISTINCT FROM OLD.artifact_id THEN RAISE EXCEPTION 'artifact is immutable'; END IF;
  IF OLD.version_id IS NOT NULL AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN RAISE EXCEPTION 'result is immutable'; END IF;
  IF NEW.status='failed' AND NEW.failure_category='rights_denied' AND NEW.attempts=OLD.attempts
     AND (OLD.status='queued' OR (OLD.status='failed' AND OLD.failure_category IN ('storage_failed','acquisition_failed'))) THEN
    -- Rights were withdrawn before this job (re)started. Without this transition a queued job
    -- could never leave the queue, and every worker pass would fail on it again.
    NULL;
  ELSIF NEW.status='running' THEN
    PERFORM ingestion.current_rights(NEW.source_id);
    IF OLD.status='failed' AND (OLD.failure_category NOT IN ('storage_failed','acquisition_failed') OR OLD.next_attempt_at>clock_timestamp()) THEN
      RAISE EXCEPTION 'job cannot retry';
    END IF;
    IF OLD.status IN ('queued','failed') AND NEW.attempts<>OLD.attempts+1 THEN RAISE EXCEPTION 'attempt must increment'; END IF;
    IF NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 THEN RAISE EXCEPTION 'invalid attempt'; END IF;
  ELSIF OLD.status<>'running' OR NEW.status NOT IN ('failed','needs_review','pending_review') THEN
    RAISE EXCEPTION 'invalid job transition';
  END IF;
  IF NEW.status='pending_review' THEN
    -- The hand-off gate. It lives on the ingestion job (an ingestion table), not on the corpus
    -- version: a job cannot claim to have produced a reviewable result unless the evidence is
    -- complete and the rights still hold.
    PERFORM ingestion.current_rights(NEW.source_id);
    IF NOT EXISTS (SELECT 1 FROM corpus.document_versions v WHERE v.id=NEW.version_id AND v.lifecycle_state='pending_review')
       OR NOT EXISTS (SELECT 1 FROM ingestion.review_tasks t WHERE t.job_id=NEW.id AND t.version_id=NEW.version_id)
       OR NOT EXISTS (SELECT 1 FROM corpus.passages p WHERE p.version_id=NEW.version_id)
       OR EXISTS (SELECT 1 FROM corpus.passages p WHERE p.version_id=NEW.version_id
                    AND NOT EXISTS (SELECT 1 FROM ingestion.passage_evidence pe WHERE pe.passage_id=p.id)) THEN
      RAISE EXCEPTION 'unvalidated hand-off' USING HINT='ingestion.unvalidated_handoff';
    END IF;
  END IF;
  IF NEW.artifact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ingestion.artifacts a WHERE a.id=NEW.artifact_id AND a.source_id=NEW.source_id AND a.jurisdiction_id=NEW.jurisdiction_id
      AND a.checksum=NEW.request->>'expectedChecksum') THEN RAISE EXCEPTION 'artifact scope mismatch'; END IF;
  IF NEW.version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ingestion.version_evidence e WHERE e.job_id=NEW.id AND e.version_id=NEW.version_id) THEN
    RAISE EXCEPTION 'result scope mismatch'; END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_guard BEFORE INSERT OR UPDATE ON ingestion.jobs FOR EACH ROW EXECUTE FUNCTION ingestion.guard_job();

-- All evidence is append-only. There is no mutable machine-to-verified metadata shortcut.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['artifacts','extractions','version_evidence','passage_evidence','citation_candidates',
    'identities','review_tasks','review_decisions','stage_events'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON ingestion.%I FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation()',t);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON ingestion.%I FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation()',t);
  END LOOP;
END $$;
CREATE TRIGGER jobs_no_delete BEFORE DELETE ON ingestion.jobs FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER jobs_no_truncate BEFORE TRUNCATE ON ingestion.jobs FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

GRANT SELECT ON ALL TABLES IN SCHEMA ingestion TO legalintel_ingest,legalintel_dataops;
GRANT INSERT ON ingestion.jobs,ingestion.artifacts,ingestion.extractions,ingestion.version_evidence,
  ingestion.passage_evidence,ingestion.citation_candidates,ingestion.identities,ingestion.review_tasks,ingestion.stage_events TO legalintel_ingest;
GRANT UPDATE(status,stage,attempts,artifact_id,version_id,failure_category,failure_summary,next_attempt_at,updated_at) ON ingestion.jobs TO legalintel_ingest;
GRANT INSERT ON ingestion.review_decisions TO legalintel_dataops;

-- Every ingestion write is validated against the rows it claims to describe. All checks are
-- written so that a NULL (a missing key in the evidence JSON) is a failure, never a pass:
-- in PL/pgSQL an IF over NULL is not taken, so each check is phrased as "must be provably true".
CREATE FUNCTION ingestion.validate_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j ingestion.jobs; a ingestion.artifacts; v corpus.document_versions;
  p corpus.passages; e ingestion.extractions; f jsonb; g graph.citations; t ingestion.review_tasks;
  v_source uuid; v_state text;
BEGIN
  IF TG_TABLE_NAME='artifacts' THEN
    IF NEW.rights_decision_id IS DISTINCT FROM ingestion.current_rights(NEW.source_id) THEN
      RAISE EXCEPTION 'stale rights evidence' USING HINT='ingestion.stale_rights_evidence'; END IF;
  ELSIF TG_TABLE_NAME='extractions' THEN
    SELECT * INTO j FROM ingestion.jobs WHERE id=NEW.job_id;
    PERFORM ingestion.current_rights(j.source_id);
    IF j.status IS DISTINCT FROM 'running' OR j.artifact_id IS DISTINCT FROM NEW.artifact_id THEN
      RAISE EXCEPTION 'extraction scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME='version_evidence' THEN
    SELECT * INTO j FROM ingestion.jobs WHERE id=NEW.job_id;
    SELECT * INTO a FROM ingestion.artifacts WHERE id=NEW.artifact_id;
    SELECT * INTO v FROM corpus.document_versions WHERE id=NEW.version_id;
    SELECT * INTO e FROM ingestion.extractions WHERE job_id=NEW.job_id;
    PERFORM ingestion.current_rights(j.source_id);
    IF NOT COALESCE(j.status='running' AND v.lifecycle_state='ingesting' AND j.artifact_id=a.id AND e.artifact_id=a.id
       AND v.source_id=a.source_id AND v.jurisdiction_id=a.jurisdiction_id
       AND encode(v.content_checksum,'hex')=a.checksum AND v.storage_key=a.storage_key
       AND v.acquired_at=a.acquired_at AND v.pipeline_version=j.pipeline_version, false) THEN
      RAISE EXCEPTION 'version provenance mismatch'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.fields) x WHERE x->>'field'='title' AND length(x->>'value')>0) THEN
      RAISE EXCEPTION 'missing title evidence'; END IF;
    FOR f IN SELECT value FROM jsonb_array_elements(NEW.fields) LOOP
      -- Machine output is never verified: the only review state accepted here is 'unreviewed'.
      IF NOT COALESCE(f->>'origin' IN ('parser','deterministic','machine')
        AND f->>'reviewState'='unreviewed'
        AND f->>'value'=f->>'quote'
        AND (f->>'confidence')::numeric BETWEEN 0 AND 1
        AND (f->>'start')::integer>=0 AND (f->>'end')::integer>(f->>'start')::integer
        AND substring(e.text FROM (f->>'start')::integer+1 FOR (f->>'end')::integer-(f->>'start')::integer)=f->>'quote', false) THEN
        RAISE EXCEPTION 'invalid metadata evidence'; END IF;
    END LOOP;
    FOR f IN SELECT value FROM jsonb_array_elements(NEW.concepts) LOOP
      IF NOT COALESCE((f->>'start')::integer>=0 AND (f->>'end')::integer>(f->>'start')::integer
        AND substring(e.text FROM (f->>'start')::integer+1 FOR (f->>'end')::integer-(f->>'start')::integer)=f->>'quote', false) THEN
        RAISE EXCEPTION 'invalid concept evidence'; END IF;
    END LOOP;
  ELSIF TG_TABLE_NAME='passage_evidence' THEN
    SELECT * INTO p FROM corpus.passages WHERE id=NEW.passage_id;
    SELECT x.* INTO e FROM ingestion.extractions x JOIN ingestion.version_evidence ve ON ve.job_id=x.job_id WHERE ve.version_id=NEW.version_id;
    IF NOT COALESCE(substring(e.text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset)=p.text, false) THEN
      RAISE EXCEPTION 'passage extraction mismatch'; END IF;
  ELSIF TG_TABLE_NAME='citation_candidates' THEN
    SELECT * INTO p FROM corpus.passages WHERE id=NEW.passage_id;
    IF NOT COALESCE(NEW.identifier=NEW.quote
       AND substring(p.text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset)=NEW.quote, false) THEN
      RAISE EXCEPTION 'citation evidence mismatch'; END IF;
    IF NEW.graph_citation_id IS NOT NULL THEN
      SELECT * INTO g FROM graph.citations WHERE id=NEW.graph_citation_id;
      IF NOT COALESCE(g.from_version_id=NEW.version_id AND g.evidence_passage_id=NEW.passage_id
        AND g.to_document_id=NEW.target_document_id AND g.citation_text=NEW.quote
        AND g.origin='machine' AND g.relationship_type='cites' AND g.review_status='unreviewed', false) THEN
        RAISE EXCEPTION 'citation graph mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='identities' THEN
    IF NOT EXISTS(SELECT 1 FROM corpus.sources s JOIN corpus.legal_documents d ON d.jurisdiction_id=s.jurisdiction_id
      WHERE s.id=NEW.source_id AND d.id=NEW.document_id AND d.document_type=NEW.document_type) THEN
      RAISE EXCEPTION 'identity jurisdiction mismatch'; END IF;
  ELSIF TG_TABLE_NAME='review_tasks' THEN
    SELECT * INTO j FROM ingestion.jobs WHERE id=NEW.job_id;
    IF j.status IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'review requires active job'; END IF;
    IF NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ingestion.version_evidence ve WHERE ve.version_id=NEW.version_id AND ve.job_id=j.id) THEN
      RAISE EXCEPTION 'review scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME='review_decisions' THEN
    SELECT * INTO t FROM ingestion.review_tasks WHERE id=NEW.task_id;
    IF EXISTS(SELECT 1 FROM ingestion.review_decisions d WHERE d.task_id=NEW.task_id AND d.decision IN ('approve','reject')) THEN
      RAISE EXCEPTION 'review task already decided' USING HINT='ingestion.task_decided'; END IF;
    IF t.version_id IS NULL THEN
      -- A failure or a duplicate has no version to approve: a person may reject it (close it as
      -- not proceeding) or hold it, never approve it.
      IF NEW.decision='approve' OR NEW.corpus_decision_id IS NOT NULL THEN
        RAISE EXCEPTION 'cannot approve an unresolved failure or duplicate' USING HINT='ingestion.cannot_approve'; END IF;
    ELSE
      SELECT source_id, lifecycle_state INTO v_source, v_state FROM corpus.document_versions WHERE id=t.version_id;
      IF NOT EXISTS(SELECT 1 FROM corpus.version_review_decisions c
                     WHERE c.id=NEW.corpus_decision_id AND c.version_id=t.version_id
                       AND c.decision=NEW.decision AND c.decided_by=NEW.actor_id) THEN
        RAISE EXCEPTION 'the decision must first be recorded in the corpus' USING HINT='ingestion.corpus_decision_required'; END IF;
      IF NEW.decision='approve' THEN
        -- Approval re-checks the rights. Rejecting or holding never does: refusing stays possible
        -- after a revocation.
        PERFORM ingestion.current_rights(v_source);
        IF v_state IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'version state does not match the decision'; END IF;
      ELSIF NEW.decision='reject' THEN
        IF v_state IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'version state does not match the decision'; END IF;
      ELSIF v_state IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'version state does not match the decision';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['artifacts','extractions','version_evidence','passage_evidence','citation_candidates',
    'identities','review_tasks','review_decisions'] LOOP
    EXECUTE format('CREATE TRIGGER validate BEFORE INSERT ON ingestion.%I FOR EACH ROW EXECUTE FUNCTION ingestion.validate_evidence()',t);
  END LOOP;
END $$;
