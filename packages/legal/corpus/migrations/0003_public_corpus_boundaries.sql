-- Corpus-owned invariants that Stage 5 ingestion depends on. They live HERE, in the corpus
-- package's migrations, because they are properties of the corpus domain (who may enter it,
-- when rights are in force, when a version may be reviewed or approved, whether passages can
-- change). Ingestion consumes them; it does not install behaviour on corpus tables.

-- ---------------------------------------------------------------------------------------
-- 1. The corpus is PUBLIC-corpus only.
--    `user_supplied` sources had no defined meaning here, and were a path from private
--    organisation material into the public corpus (a source of that kind, once approved, could
--    feed an ingestion job and later be published). Private tenant documents belong in a
--    separate, tenant-scoped schema with row-level security and are never sources of this
--    table. Removing the value makes the path impossible instead of merely discouraged.
-- ---------------------------------------------------------------------------------------
ALTER TABLE corpus.sources DROP CONSTRAINT sources_kind_check;
ALTER TABLE corpus.sources ADD CONSTRAINT sources_kind_check CHECK (kind IN (
  'court_registry', 'government_gazette', 'legislature', 'publisher', 'institutional_repository'));
COMMENT ON TABLE corpus.sources IS
  'Sources of the PUBLIC legal corpus only. Private organisation documents are never sources here.';

-- ---------------------------------------------------------------------------------------
-- 2. Rights in force NOW, for the specific uses an operation needs.
--    corpus.source_allows() answers per statement (now() is fixed for a transaction), which is
--    right for read policies and plans. Processing runs long, and a revocation must stop it, so
--    this re-reads the clock on every call. It returns the decision relied upon, so evidence can
--    record exactly which decision permitted an action. SECURITY DEFINER because callers cannot
--    read the ledger; it pins search_path and uses no dynamic SQL.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION corpus.rights_decision_in_force(p_source uuid, p_uses text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  d record;
  now_ts timestamptz := clock_timestamp();
BEGIN
  IF p_uses IS NULL OR cardinality(p_uses) = 0 THEN
    RAISE EXCEPTION 'an operation must name the rights it requires'
      USING ERRCODE = 'P0001', HINT = 'corpus.rights_denied';
  END IF;

  SELECT r.id, r.status, r.allowed_uses, r.expires_at INTO d
    FROM corpus.source_rights_decisions r
   WHERE r.source_id = p_source AND r.effective_from <= now_ts
   ORDER BY r.sequence DESC
   LIMIT 1;

  IF d.id IS NULL
     OR d.status <> 'approved'
     OR (d.expires_at IS NOT NULL AND d.expires_at <= now_ts)
     OR NOT (p_uses <@ d.allowed_uses) THEN
    RAISE EXCEPTION 'the rights in force for this source do not permit this operation'
      USING ERRCODE = 'P0001', HINT = 'corpus.rights_denied';
  END IF;
  RETURN d.id;
END
$$;
REVOKE ALL ON FUNCTION corpus.rights_decision_in_force(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION corpus.rights_decision_in_force(uuid, text[])
  TO legalintel_ingest, legalintel_dataops;

-- ---------------------------------------------------------------------------------------
-- 3. Passages are immutable rows. While a version is still ingesting a passage set can be
--    replaced (delete + insert), but a row is never edited in place, and any passage that
--    is cited or used as evidence cannot be deleted (foreign keys). The existing
--    passages_frozen trigger keeps refusing every change once a version leaves ingestion.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION corpus.reject_passage_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'a passage is an immutable row; replace it by delete and insert while the version is ingesting'
    USING ERRCODE = 'P0001', HINT = 'corpus.passages_immutable';
END
$$;
CREATE TRIGGER passages_immutable BEFORE UPDATE ON corpus.passages
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_passage_update();

-- ---------------------------------------------------------------------------------------
-- 4. A version is approved only by a recorded human review decision, and only versions that
--    actually contain passages may be handed to review. Decisions are append-only; the LATEST
--    decision for a version governs, so a later reject or hold withdraws an earlier approve.
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.version_review_decisions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence    bigint      GENERATED ALWAYS AS IDENTITY,
  version_id  uuid        NOT NULL REFERENCES corpus.document_versions (id),
  decision    text        NOT NULL CHECK (decision IN ('approve', 'reject', 'hold')),
  reason_code text        NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  decided_by  uuid        NOT NULL REFERENCES iam.users (id),
  decided_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX version_review_decisions_latest_idx
  ON corpus.version_review_decisions (version_id, sequence DESC);
CREATE TRIGGER review_decisions_no_update BEFORE UPDATE ON corpus.version_review_decisions
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER review_decisions_no_delete BEFORE DELETE ON corpus.version_review_decisions
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER review_decisions_no_truncate BEFORE TRUNCATE ON corpus.version_review_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

CREATE FUNCTION corpus.enforce_review_decision() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_state text;
BEGIN
  SELECT lifecycle_state INTO current_state FROM corpus.document_versions WHERE id = NEW.version_id;
  IF current_state IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'a review decision can only be recorded for a version awaiting review'
      USING ERRCODE = 'P0001', HINT = 'corpus.review_not_pending';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER review_decisions_pending_only BEFORE INSERT ON corpus.version_review_decisions
  FOR EACH ROW EXECUTE FUNCTION corpus.enforce_review_decision();

-- SECURITY INVOKER: both roles that move versions can read the tables it consults, so it needs
-- no elevated privilege.
CREATE FUNCTION corpus.enforce_review_gate() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lifecycle_state = 'pending_review' AND OLD.lifecycle_state IS DISTINCT FROM 'pending_review' THEN
    IF NOT EXISTS (SELECT 1 FROM corpus.passages p WHERE p.version_id = NEW.id) THEN
      RAISE EXCEPTION 'a version with no passages cannot be handed to review'
        USING ERRCODE = 'P0001', HINT = 'corpus.review_not_ready';
    END IF;
  END IF;

  IF NEW.lifecycle_state = 'approved' AND OLD.lifecycle_state IS DISTINCT FROM 'approved' THEN
    IF NOT EXISTS (
      SELECT 1 FROM corpus.version_review_decisions d
       WHERE d.version_id = NEW.id
         AND d.decision = 'approve'
         AND d.decided_by = NEW.approved_by
         AND d.sequence = (SELECT max(x.sequence) FROM corpus.version_review_decisions x
                            WHERE x.version_id = NEW.id)
    ) THEN
      RAISE EXCEPTION 'approval requires the latest recorded review decision to be an approval by the approver'
        USING ERRCODE = 'P0001', HINT = 'corpus.review_decision_required';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
-- Named to sort after versions_lifecycle, so transition validity is checked first.
CREATE TRIGGER versions_review_gate BEFORE UPDATE ON corpus.document_versions
  FOR EACH ROW EXECUTE FUNCTION corpus.enforce_review_gate();

GRANT SELECT ON corpus.version_review_decisions TO legalintel_ingest, legalintel_dataops;
GRANT INSERT ON corpus.version_review_decisions TO legalintel_dataops;

-- ---------------------------------------------------------------------------------------
-- 5. A rejected version must not block re-ingesting the same bytes (for example after a
--    parser fix): uniqueness of content per work applies to versions that are not rejected.
--    Rejected versions stay as history.
-- ---------------------------------------------------------------------------------------
ALTER TABLE corpus.document_versions DROP CONSTRAINT document_versions_document_id_content_checksum_key;
CREATE UNIQUE INDEX document_versions_content_unique
  ON corpus.document_versions (document_id, content_checksum)
  WHERE lifecycle_state <> 'rejected';
