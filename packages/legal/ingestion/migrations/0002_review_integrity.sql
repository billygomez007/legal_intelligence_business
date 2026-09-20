-- Review and provenance integrity for ingestion. Forward migration: ingestion 0001 is untouched.
-- Design: docs/adr/0008-integrity-hardening-stages-0-5.md.
--
-- Ownership: everything here is about ingestion's own tables and jobs. Ingestion may depend on
-- the corpus; the corpus never depends on ingestion, so nothing here installs a trigger on a
-- corpus table.

-- ---------------------------------------------------------------------------------------
-- 1. Provenance attestation: the ONLY way a version becomes attestable.
--
--    The corpus refuses to approve or publish a version until a provenance attestation exists
--    (corpus 0004), and it cannot read ingestion tables to check ingestion's evidence. So the
--    attestation is written here, by ingestion, and only after ingestion's own evidence checks
--    have passed. No runtime role can insert into corpus.version_provenance_attestations
--    directly. This function is the sole writer, and it does not take the attested facts from its
--    caller: it takes a JOB, requires that the job passed the hand-off gate (ingestion 0001's
--    guard_job), and derives every value from the evidence it has verified. A caller who cannot
--    produce valid evidence cannot produce an attestation, however the SQL is phrased.
--
--    SECURITY DEFINER is necessary and narrow: it exists so that ingest can cause exactly one kind
--    of write to a corpus table it may not write to itself. It pins its search_path, uses only
--    static SQL, reads only ingestion tables (no row-level security applies to them), and is
--    executable by the ingest role alone.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION ingestion.attest_provenance(p_job uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  j    ingestion.jobs;
  a    ingestion.artifacts;
  e    ingestion.extractions;
  ve   ingestion.version_evidence;
  v_id uuid;
BEGIN
  SELECT * INTO j FROM ingestion.jobs WHERE id = p_job;
  -- Only a job that has already passed the hand-off gate: the version awaits review, with its
  -- evidence, review task and passage records in place, and the rights held when it was handed off.
  IF j.id IS NULL OR j.status <> 'pending_review' OR j.version_id IS NULL OR j.artifact_id IS NULL THEN
    RAISE EXCEPTION 'only a job that has passed the hand-off gate can be attested'
      USING ERRCODE = 'P0001', HINT = 'ingestion.attestation_not_ready';
  END IF;

  SELECT * INTO a  FROM ingestion.artifacts        WHERE id = j.artifact_id;
  SELECT * INTO e  FROM ingestion.extractions      WHERE job_id = j.id;
  SELECT * INTO ve FROM ingestion.version_evidence WHERE version_id = j.version_id;

  -- The evidence must all be the same job's: one artifact, extracted once, described once.
  IF NOT COALESCE(
       a.id IS NOT NULL AND e.job_id IS NOT NULL AND ve.version_id IS NOT NULL
       AND e.artifact_id = a.id AND ve.job_id = j.id AND ve.artifact_id = a.id
       AND a.source_id = j.source_id AND a.jurisdiction_id = j.jurisdiction_id, false) THEN
    RAISE EXCEPTION 'the job evidence does not describe one artifact, extraction and version'
      USING ERRCODE = 'P0001', HINT = 'ingestion.attestation_not_ready';
  END IF;

  -- Attesting is a claim that will be relied on when the version is approved, so the rights that
  -- allow this processing must hold now, not only when the job was handed off.
  PERFORM ingestion.current_rights(j.source_id);

  INSERT INTO corpus.version_provenance_attestations
    (version_id, source_id, content_checksum, pipeline_version, attestation_type,
     attestation_version, evidence_reference, system_identity, actor_id)
  VALUES
    (j.version_id, a.source_id, decode(a.checksum, 'hex'), j.pipeline_version, 'ingestion_pipeline', 1,
     'ingestion:job=' || j.id::text || ';artifact=' || a.id::text || ';text=' || e.text_checksum,
     'ingestion-pipeline', j.actor_id)
  ON CONFLICT (version_id, attestation_type, attestation_version) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Already attested (a retry): the same answer, not a second record.
    SELECT t.id INTO v_id
      FROM corpus.version_provenance_attestations t
     WHERE t.version_id = j.version_id AND t.attestation_type = 'ingestion_pipeline'
       AND t.attestation_version = 1;
  END IF;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION ingestion.attest_provenance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ingestion.attest_provenance(uuid) TO legalintel_ingest;

-- A job cannot END its transaction awaiting review without its attestation. Deferred to the end
-- of the transaction because the hand-off runs in one: the job reaches pending_review, then the
-- pipeline attests it, and only the finished state has to satisfy this. It makes a pipeline that
-- forgets to attest fail loudly at hand-off, not later at approval, where the version would sit
-- in the review queue unable to be approved.
CREATE FUNCTION ingestion.require_attestation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM corpus.version_provenance_attestations a
     WHERE a.version_id = NEW.version_id AND a.attestation_type = 'ingestion_pipeline'
  ) THEN
    RAISE EXCEPTION 'a job cannot end awaiting review without its provenance attestation'
      USING ERRCODE = 'P0001', HINT = 'ingestion.attestation_missing';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER jobs_attested
  AFTER UPDATE OF status ON ingestion.jobs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'pending_review')
  EXECUTE FUNCTION ingestion.require_attestation();

-- ---------------------------------------------------------------------------------------
-- 2. The person who requested an ingestion cannot approve its result.
--
--    Role separation is not separation of duties: one person can hold both the permission to
--    request ingestion and the permission to review it. Whoever asked for a document to be
--    ingested must not be the one who accepts it, or the review checks nothing.
--
--    The rule is about APPROVAL only. A requester may still inspect, reject (withdrawing their own
--    request) and hold, none of which can put anything in front of a user.
--
--    It lives HERE and not in the corpus, because the requester (ingestion.jobs.actor_id) is an
--    ingestion fact and the corpus must not depend on ingestion. The corpus decision is recorded
--    first and this row mirrors it in the same transaction, so refusing the mirror rolls back the
--    whole review, including the corpus decision recorded a moment before.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION ingestion.enforce_review_separation() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_requester uuid;
BEGIN
  IF NEW.decision <> 'approve' THEN
    RETURN NEW;
  END IF;

  SELECT j.actor_id INTO v_requester
    FROM ingestion.review_tasks t
    JOIN ingestion.jobs j ON j.id = t.job_id
   WHERE t.id = NEW.task_id;

  IF v_requester IS NOT DISTINCT FROM NEW.actor_id THEN
    RAISE EXCEPTION 'the person who requested an ingestion cannot approve its result'
      USING ERRCODE = 'P0001', HINT = 'ingestion.requester_cannot_approve';
  END IF;
  RETURN NEW;
END
$$;

-- Named to sort before `validate` (ingestion 0001), so the separation is decided first.
CREATE TRIGGER review_separation
  BEFORE INSERT ON ingestion.review_decisions
  FOR EACH ROW EXECUTE FUNCTION ingestion.enforce_review_separation();
