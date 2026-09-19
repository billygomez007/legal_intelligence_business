-- Stage 5: operational records are public-corpus ONLY. No tenant key or tenant FK exists.
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
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
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
  text_checksum text GENERATED ALWAYS AS (encode(sha256(convert_to(text,'UTF8')),'hex')) STORED,
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
CREATE TABLE ingestion.review_decisions (
  task_id uuid PRIMARY KEY REFERENCES ingestion.review_tasks(id),
  decision text NOT NULL CHECK(decision IN ('approve','reject','hold')),
  actor_id uuid NOT NULL REFERENCES iam.users(id),
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
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

-- Re-evaluate clock time even within a transaction, unlike the historical stable read gate.
CREATE FUNCTION ingestion.current_rights(p_source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE d corpus.source_rights_decisions; t timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO d FROM corpus.source_rights_decisions WHERE source_id=p_source AND effective_from<=t
    ORDER BY sequence DESC LIMIT 1;
  IF d.id IS NULL OR d.status <> 'approved' OR (d.expires_at IS NOT NULL AND d.expires_at<=t)
     OR NOT (ARRAY['acquire_store','derive_metadata']::text[] <@ d.allowed_uses) THEN
    RAISE EXCEPTION 'processing rights denied' USING HINT='ingestion.rights_denied';
  END IF;
  RETURN d.id;
END $$;
REVOKE ALL ON FUNCTION ingestion.current_rights(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ingestion.current_rights(uuid) TO legalintel_ingest,legalintel_dataops;

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
  IF NEW.status='running' THEN
    PERFORM ingestion.current_rights(NEW.source_id);
    IF OLD.status='failed' AND (OLD.failure_category NOT IN ('storage_failed','acquisition_failed') OR OLD.next_attempt_at>clock_timestamp()) THEN
      RAISE EXCEPTION 'job cannot retry';
    END IF;
    IF OLD.status IN ('queued','failed') AND NEW.attempts<>OLD.attempts+1 THEN RAISE EXCEPTION 'attempt must increment'; END IF;
    IF NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 THEN RAISE EXCEPTION 'invalid attempt'; END IF;
  ELSIF OLD.status<>'running' OR NEW.status NOT IN ('failed','needs_review','pending_review') THEN
    RAISE EXCEPTION 'invalid job transition';
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

CREATE FUNCTION ingestion.validate_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j ingestion.jobs; a ingestion.artifacts; v corpus.document_versions;
  p corpus.passages; e ingestion.extractions; f jsonb; g graph.citations;
BEGIN
  IF TG_TABLE_NAME='artifacts' THEN
    IF NEW.rights_decision_id<>ingestion.current_rights(NEW.source_id) THEN RAISE EXCEPTION 'stale rights evidence'; END IF;
  ELSIF TG_TABLE_NAME='extractions' THEN
    SELECT * INTO j FROM ingestion.jobs WHERE id=NEW.job_id;
    PERFORM ingestion.current_rights(j.source_id);
    IF j.status<>'running' OR j.artifact_id IS DISTINCT FROM NEW.artifact_id THEN RAISE EXCEPTION 'extraction scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME='version_evidence' THEN
    SELECT * INTO j FROM ingestion.jobs WHERE id=NEW.job_id;
    SELECT * INTO a FROM ingestion.artifacts WHERE id=NEW.artifact_id;
    SELECT * INTO v FROM corpus.document_versions WHERE id=NEW.version_id;
    SELECT * INTO e FROM ingestion.extractions WHERE job_id=NEW.job_id;
    PERFORM ingestion.current_rights(j.source_id);
    IF j.status<>'running' OR v.lifecycle_state<>'ingesting' OR j.artifact_id IS DISTINCT FROM a.id OR e.artifact_id IS DISTINCT FROM a.id
       OR v.source_id IS DISTINCT FROM a.source_id OR v.jurisdiction_id IS DISTINCT FROM a.jurisdiction_id
       OR encode(v.content_checksum,'hex') IS DISTINCT FROM a.checksum OR v.storage_key IS DISTINCT FROM a.storage_key
       OR v.acquired_at IS DISTINCT FROM a.acquired_at OR v.pipeline_version IS DISTINCT FROM j.pipeline_version THEN
      RAISE EXCEPTION 'version provenance mismatch';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.fields) x WHERE x->>'field'='title' AND length(x->>'value')>0) THEN
      RAISE EXCEPTION 'missing title evidence'; END IF;
    FOR f IN SELECT value FROM jsonb_array_elements(NEW.fields) LOOP
      IF f->>'origin' NOT IN ('parser','deterministic','machine') OR f->>'reviewState' IS DISTINCT FROM 'unreviewed'
        OR f->>'value' IS DISTINCT FROM f->>'quote' OR (f->>'confidence')::numeric NOT BETWEEN 0 AND 1
        OR (f->>'start')::integer<0 OR (f->>'end')::integer<=(f->>'start')::integer
        OR substring(e.text FROM (f->>'start')::integer+1 FOR (f->>'end')::integer-(f->>'start')::integer) IS DISTINCT FROM f->>'quote' THEN
        RAISE EXCEPTION 'invalid metadata evidence'; END IF;
    END LOOP;
    FOR f IN SELECT value FROM jsonb_array_elements(NEW.concepts) LOOP
      IF (f->>'start')::integer<0 OR (f->>'end')::integer<=(f->>'start')::integer OR
        substring(e.text FROM (f->>'start')::integer+1 FOR (f->>'end')::integer-(f->>'start')::integer) IS DISTINCT FROM f->>'quote' THEN
        RAISE EXCEPTION 'invalid concept evidence'; END IF;
    END LOOP;
  ELSIF TG_TABLE_NAME='passage_evidence' THEN
    SELECT * INTO p FROM corpus.passages WHERE id=NEW.passage_id;
    SELECT x.* INTO e FROM ingestion.extractions x JOIN ingestion.version_evidence ve ON ve.job_id=x.job_id WHERE ve.version_id=NEW.version_id;
    IF substring(e.text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset) IS DISTINCT FROM p.text THEN
      RAISE EXCEPTION 'passage extraction mismatch'; END IF;
  ELSIF TG_TABLE_NAME='citation_candidates' THEN
    SELECT * INTO p FROM corpus.passages WHERE id=NEW.passage_id;
    IF NEW.identifier<>NEW.quote OR substring(p.text FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset) IS DISTINCT FROM NEW.quote THEN
      RAISE EXCEPTION 'citation evidence mismatch'; END IF;
    IF NEW.graph_citation_id IS NOT NULL THEN
      SELECT * INTO g FROM graph.citations WHERE id=NEW.graph_citation_id;
      IF g.from_version_id IS DISTINCT FROM NEW.version_id OR g.evidence_passage_id IS DISTINCT FROM NEW.passage_id
        OR g.to_document_id IS DISTINCT FROM NEW.target_document_id OR g.citation_text IS DISTINCT FROM NEW.quote
        OR g.origin IS DISTINCT FROM 'machine' OR g.relationship_type IS DISTINCT FROM 'cites' OR g.review_status IS DISTINCT FROM 'unreviewed' THEN
        RAISE EXCEPTION 'citation graph mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='identities' THEN
    IF NOT EXISTS(SELECT 1 FROM corpus.sources s JOIN corpus.legal_documents d ON d.jurisdiction_id=s.jurisdiction_id
      WHERE s.id=NEW.source_id AND d.id=NEW.document_id AND d.document_type=NEW.document_type) THEN
      RAISE EXCEPTION 'identity jurisdiction mismatch'; END IF;
  ELSIF TG_TABLE_NAME='review_tasks' THEN
    SELECT * INTO j FROM ingestion.jobs WHERE id=NEW.job_id;
    IF j.status<>'running' THEN RAISE EXCEPTION 'review requires active job'; END IF;
    IF NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ingestion.version_evidence ve WHERE ve.version_id=NEW.version_id AND ve.job_id=j.id) THEN
      RAISE EXCEPTION 'review scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['artifacts','extractions','version_evidence','passage_evidence','citation_candidates','identities','review_tasks'] LOOP
    EXECUTE format('CREATE TRIGGER validate BEFORE INSERT ON ingestion.%I FOR EACH ROW EXECUTE FUNCTION ingestion.validate_evidence()',t);
  END LOOP;
END $$;

-- Once evidence exists, its exact passages cannot be moved/rewritten, even while ingesting.
CREATE FUNCTION ingestion.freeze_evidenced_passage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM ingestion.passage_evidence WHERE passage_id=OLD.id) THEN RAISE EXCEPTION 'evidenced passage is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ingestion.freeze_evidenced_passage() FROM PUBLIC;
CREATE TRIGGER ingestion_passage_freeze BEFORE UPDATE OR DELETE ON corpus.passages
  FOR EACH ROW EXECUTE FUNCTION ingestion.freeze_evidenced_passage();

CREATE FUNCTION ingestion.guard_handoff() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE e ingestion.version_evidence;
BEGIN
  IF NEW.pipeline_version NOT LIKE 'ingestion/%' THEN RETURN NEW; END IF;
  SELECT * INTO e FROM ingestion.version_evidence WHERE version_id=NEW.id;
  IF NEW.lifecycle_state='pending_review' THEN
    PERFORM ingestion.current_rights(NEW.source_id);
    IF e.version_id IS NULL OR NOT EXISTS(SELECT 1 FROM ingestion.review_tasks WHERE version_id=NEW.id)
      OR NOT EXISTS(SELECT 1 FROM corpus.passages WHERE version_id=NEW.id)
      OR EXISTS(SELECT 1 FROM corpus.passages p WHERE p.version_id=NEW.id AND NOT EXISTS(SELECT 1 FROM ingestion.passage_evidence pe WHERE pe.passage_id=p.id)) THEN
      RAISE EXCEPTION 'unvalidated handoff'; END IF;
  ELSIF NEW.lifecycle_state='approved' THEN
    IF NOT EXISTS(SELECT 1 FROM ingestion.review_tasks t JOIN ingestion.review_decisions d ON d.task_id=t.id
      WHERE t.version_id=NEW.id AND d.decision='approve' AND d.actor_id=NEW.approved_by) THEN
      RAISE EXCEPTION 'human review decision required'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ingestion.guard_handoff() FROM PUBLIC;
CREATE TRIGGER ingestion_handoff BEFORE UPDATE ON corpus.document_versions FOR EACH ROW EXECUTE FUNCTION ingestion.guard_handoff();

CREATE FUNCTION ingestion.decide_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t ingestion.review_tasks;
BEGIN
  SELECT * INTO t FROM ingestion.review_tasks WHERE id=NEW.task_id;
  IF t.version_id IS NULL AND NEW.decision='approve' THEN RAISE EXCEPTION 'cannot approve unresolved failure or duplicate'; END IF;
  IF t.version_id IS NOT NULL AND NEW.decision IN ('approve','reject') THEN
    PERFORM ingestion.current_rights((SELECT source_id FROM corpus.document_versions WHERE id=t.version_id));
    UPDATE corpus.document_versions SET lifecycle_state=CASE WHEN NEW.decision='approve' THEN 'approved' ELSE 'rejected' END,
      approved_by=CASE WHEN NEW.decision='approve' THEN NEW.actor_id ELSE approved_by END WHERE id=t.version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'review version unavailable'; END IF;
  END IF;
  INSERT INTO audit.platform_events(actor_kind,actor_id,action,outcome,resource_type,resource_id,metadata)
    VALUES('user',NEW.actor_id::text,'ingestion.review_decided','success','review_task',NEW.task_id::text,
      jsonb_build_object('decision',NEW.decision,'reasonCode',NEW.reason_code));
  RETURN NEW;
END $$;
CREATE TRIGGER review_apply AFTER INSERT ON ingestion.review_decisions FOR EACH ROW EXECUTE FUNCTION ingestion.decide_review();

CREATE FUNCTION ingestion.audit_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.pipeline_version LIKE 'ingestion/%' AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    INSERT INTO audit.platform_events(actor_kind,actor_id,action,outcome,resource_type,resource_id,metadata)
      VALUES(CASE WHEN NEW.lifecycle_state IN ('approved','published') THEN 'user' ELSE 'system' END,
        CASE WHEN NEW.lifecycle_state='approved' THEN NEW.approved_by::text WHEN NEW.lifecycle_state='published' THEN NEW.published_by::text ELSE NULL END,
        'corpus.'||NEW.lifecycle_state,'success','document_version',NEW.id::text,
        jsonb_build_object('previousState',OLD.lifecycle_state));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ingestion.audit_lifecycle() FROM PUBLIC;
CREATE TRIGGER ingestion_lifecycle_audit AFTER UPDATE ON corpus.document_versions FOR EACH ROW EXECUTE FUNCTION ingestion.audit_lifecycle();
