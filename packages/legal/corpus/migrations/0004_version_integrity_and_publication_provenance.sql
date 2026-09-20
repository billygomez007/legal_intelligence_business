-- Version integrity and publication provenance. Forward migration: corpus 0001-0003 are untouched.
-- Design: docs/adr/0008-integrity-hardening-stages-0-5.md.
--
-- Ownership: everything here is a property of the corpus and depends only on corpus (and iam)
-- objects. Nothing in this file reads an ingestion table; ingestion (a later migration set)
-- consumes what this file defines.

-- ---------------------------------------------------------------------------------------
-- 1. Succession of versions is within ONE document.
--
--    `supersedes_version_id` was a plain reference to any version in the corpus, so a version of
--    document B could claim to supersede a version of document A. That corrupts the version
--    chain a reader follows to find "the current text of this law". Version succession is a fact
--    about one work; how DIFFERENT documents relate (amends, repeals, supersedes, distinguishes,
--    cites) is a legal relationship and belongs in the citation graph, with evidence.
--
--    A composite foreign key makes the same-document rule structural. It also covers "the
--    version must exist", so the single-column key it replaces is dropped (keeping both would
--    make the reported constraint depend on which one PostgreSQL checked first).
-- ---------------------------------------------------------------------------------------
ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_id_document_key UNIQUE (id, document_id);

ALTER TABLE corpus.document_versions
  DROP CONSTRAINT document_versions_supersedes_version_id_fkey;

ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_supersedes_same_document
  FOREIGN KEY (supersedes_version_id, document_id)
  REFERENCES corpus.document_versions (id, document_id);

ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_not_self_superseding
  CHECK (supersedes_version_id IS DISTINCT FROM id);

-- ---------------------------------------------------------------------------------------
-- 2. Publish-critical metadata must be verified by a person before a version is approved.
--
--    Machine extraction proposes values; it never verifies them (ingestion stores machine
--    metadata as `unreviewed` and refuses anything else). Until now nothing stopped a version
--    whose title, court or date was machine-only from being approved. The model is:
--
--      machine extraction  ->  value recorded in the corpus  ->  a person verifies THAT value
--                                                             ->  the approval gate checks it
--
--    A verification is an append-only, field-level record by a named person, with the evidence
--    they checked, bound to the exact value they saw (a fingerprint the database recomputes and
--    compares), with the time assigned by the database. There is no "verified" flag to flip:
--    change the value and the verification no longer matches, so it must be made again.
--
--    Which fields are critical depends on the document type, so the rules are DATA (below),
--    not code: a case needs a court and a decision date; legislation does not.
-- ---------------------------------------------------------------------------------------
CREATE TABLE corpus.critical_metadata_fields (
  document_type text NOT NULL CHECK (document_type IN (
                  'case', 'legislation', 'regulation', 'court_rule',
                  'practice_direction', 'treaty', 'gazette_notice', 'commentary')),
  field         text NOT NULL CHECK (field IN (
                  'title', 'jurisdiction', 'court', 'decision_date',
                  'neutral_citation', 'docket_number', 'instrument_number')),
  -- required:   must have a value AND a current verification.
  -- if_present: needs a verification only when the corpus records a value ("where applicable").
  requirement   text NOT NULL CHECK (requirement IN ('required', 'if_present')),
  PRIMARY KEY (document_type, field)
);
INSERT INTO corpus.critical_metadata_fields (document_type, field, requirement)
SELECT t.document_type, 'title', 'required' FROM (VALUES
  ('case'), ('legislation'), ('regulation'), ('court_rule'),
  ('practice_direction'), ('treaty'), ('gazette_notice'), ('commentary')) AS t (document_type)
UNION ALL
SELECT t.document_type, 'jurisdiction', 'required' FROM (VALUES
  ('case'), ('legislation'), ('regulation'), ('court_rule'),
  ('practice_direction'), ('treaty'), ('gazette_notice'), ('commentary')) AS t (document_type);
INSERT INTO corpus.critical_metadata_fields (document_type, field, requirement) VALUES
  ('case', 'court', 'required'),
  ('case', 'decision_date', 'required'),
  ('case', 'neutral_citation', 'if_present'),
  ('case', 'docket_number', 'if_present'),
  ('legislation', 'instrument_number', 'if_present');

CREATE TRIGGER critical_fields_no_update BEFORE UPDATE ON corpus.critical_metadata_fields
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER critical_fields_no_delete BEFORE DELETE ON corpus.critical_metadata_fields
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER critical_fields_no_truncate BEFORE TRUNCATE ON corpus.critical_metadata_fields
  FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

-- What the corpus currently holds for a field, as text. NULL when nothing is recorded.
-- SECURITY INVOKER: the roles that verify and approve can read every table it consults.
CREATE FUNCTION corpus.version_field_value(p_version uuid, p_field text) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE p_field
    WHEN 'title' THEN d.title
    WHEN 'jurisdiction' THEN (SELECT j.code FROM corpus.jurisdictions j WHERE j.id = v.jurisdiction_id)
    WHEN 'court' THEN (SELECT c.name FROM corpus.case_details cd
                         JOIN corpus.courts c ON c.id = cd.court_id
                        WHERE cd.document_id = v.document_id)
    WHEN 'decision_date' THEN (SELECT to_char(cd.decision_date, 'YYYY-MM-DD') FROM corpus.case_details cd
                                WHERE cd.document_id = v.document_id)
    WHEN 'neutral_citation' THEN (SELECT cd.neutral_citation FROM corpus.case_details cd
                                   WHERE cd.document_id = v.document_id)
    WHEN 'docket_number' THEN (SELECT cd.docket_number FROM corpus.case_details cd
                                WHERE cd.document_id = v.document_id)
    WHEN 'instrument_number' THEN (SELECT ld.instrument_number FROM corpus.legislation_details ld
                                    WHERE ld.document_id = v.document_id)
  END
    FROM corpus.document_versions v
    JOIN corpus.legal_documents d ON d.id = v.document_id
   WHERE v.id = p_version
$$;

-- The fingerprint a verification is bound to. The field name is part of what is hashed, so a
-- fingerprint made for one field cannot be presented for another. STABLE, not IMMUTABLE:
-- convert_to() depends on the database encoding.
CREATE FUNCTION corpus.field_fingerprint(p_field text, p_value text) RETURNS bytea
LANGUAGE sql STABLE
AS $$ SELECT sha256(convert_to(p_field || E'\n' || p_value, 'UTF8')) $$;

CREATE TABLE corpus.version_field_verifications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Strict insertion order: the LATEST record for a field governs, never a timestamp.
  sequence           bigint      GENERATED ALWAYS AS IDENTITY,
  version_id         uuid        NOT NULL REFERENCES corpus.document_versions (id),
  field              text        NOT NULL CHECK (field IN (
                       'title', 'jurisdiction', 'court', 'decision_date',
                       'neutral_citation', 'docket_number', 'instrument_number')),
  -- verified: the value is correct. rejected: the value is wrong (it must be corrected and
  -- verified again before approval).
  status             text        NOT NULL CHECK (status IN ('verified', 'rejected')),
  -- What the person saw, supplied by them and checked against the corpus by the trigger below.
  value_sha256       bytea       NOT NULL CHECK (length(value_sha256) = 32),
  -- A copy of the verified value, written by the database, so the record explains itself.
  value              text        NOT NULL,
  -- Where the person confirmed it: a page, a registry entry, a gazette reference.
  evidence_reference text        NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 1 AND 500),
  verified_by        uuid        NOT NULL REFERENCES iam.users (id),
  verified_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX version_field_verifications_latest_idx
  ON corpus.version_field_verifications (version_id, field, sequence DESC);

CREATE TRIGGER field_verifications_no_update BEFORE UPDATE ON corpus.version_field_verifications
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER field_verifications_no_delete BEFORE DELETE ON corpus.version_field_verifications
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER field_verifications_no_truncate BEFORE TRUNCATE ON corpus.version_field_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

-- A verification is made at review, of a field that matters for this document type, of the
-- value the corpus holds right now. The database writes the value and the time.
CREATE FUNCTION corpus.enforce_field_verification() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
  v_type  text;
  v_value text;
BEGIN
  SELECT v.lifecycle_state, d.document_type INTO v_state, v_type
    FROM corpus.document_versions v
    JOIN corpus.legal_documents d ON d.id = v.document_id
   WHERE v.id = NEW.version_id;

  IF v_state IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'metadata can only be verified for a version awaiting review'
      USING ERRCODE = 'P0001', HINT = 'corpus.review_not_pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM corpus.critical_metadata_fields f
                  WHERE f.document_type = v_type AND f.field = NEW.field) THEN
    RAISE EXCEPTION 'that field is not publish-critical for this kind of document'
      USING ERRCODE = 'P0001', HINT = 'corpus.field_not_applicable';
  END IF;

  v_value := corpus.version_field_value(NEW.version_id, NEW.field);
  IF v_value IS NULL OR NEW.value_sha256 IS DISTINCT FROM corpus.field_fingerprint(NEW.field, v_value) THEN
    RAISE EXCEPTION 'the verification does not match the value the corpus holds'
      USING ERRCODE = 'P0001', HINT = 'corpus.verification_stale';
  END IF;

  NEW.value := v_value;
  NEW.verified_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER field_verifications_check BEFORE INSERT ON corpus.version_field_verifications
  FOR EACH ROW EXECUTE FUNCTION corpus.enforce_field_verification();

-- For a review packet and for the gate: every critical field of a version, its current value and
-- fingerprint, the latest verification, and whether the field still blocks approval.
CREATE FUNCTION corpus.version_critical_metadata(p_version uuid)
RETURNS TABLE (
  field           text,
  requirement     text,
  current_value   text,
  current_sha256  bytea,
  latest_status   text,
  latest_by       uuid,
  latest_at       timestamptz,
  is_current      boolean,
  is_blocking     boolean
)
LANGUAGE sql STABLE
AS $$
  WITH wanted AS (
    SELECT f.field, f.requirement, corpus.version_field_value(v.id, f.field) AS value
      FROM corpus.document_versions v
      JOIN corpus.legal_documents d ON d.id = v.document_id
      JOIN corpus.critical_metadata_fields f ON f.document_type = d.document_type
     WHERE v.id = p_version
  ), held AS (
    SELECT w.field, w.requirement, w.value,
           CASE WHEN w.value IS NULL THEN NULL ELSE corpus.field_fingerprint(w.field, w.value) END AS fingerprint
      FROM wanted w
  ), judged AS (
    SELECT h.*, l.status, l.verified_by, l.verified_at,
           coalesce(l.status = 'verified' AND l.value_sha256 = h.fingerprint, false) AS matches
      FROM held h
      LEFT JOIN LATERAL (
        SELECT x.status, x.value_sha256, x.verified_by, x.verified_at
          FROM corpus.version_field_verifications x
         WHERE x.version_id = p_version AND x.field = h.field
         ORDER BY x.sequence DESC
         LIMIT 1
      ) l ON true
  )
  SELECT j.field, j.requirement, j.value, j.fingerprint, j.status, j.verified_by, j.verified_at,
         j.matches,
         NOT j.matches AND (j.requirement = 'required' OR j.value IS NOT NULL)
    FROM judged j
$$;

-- The names of the fields that still block approval. Fails closed: a document type with no
-- title row in the catalogue (a type added without its rules) is refused, never waved through.
CREATE FUNCTION corpus.unverified_critical_fields(p_version uuid) RETURNS text[]
LANGUAGE sql STABLE
AS $$
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM corpus.version_critical_metadata(p_version) m WHERE m.field = 'title')
             THEN ARRAY['title']
           ELSE coalesce((SELECT array_agg(m.field ORDER BY m.field)
                            FROM corpus.version_critical_metadata(p_version) m
                           WHERE m.is_blocking), ARRAY[]::text[])
         END
$$;

REVOKE ALL ON FUNCTION
  corpus.version_field_value(uuid, text),
  corpus.field_fingerprint(text, text),
  corpus.version_critical_metadata(uuid),
  corpus.unverified_critical_fields(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  corpus.version_field_value(uuid, text),
  corpus.field_fingerprint(text, text),
  corpus.version_critical_metadata(uuid),
  corpus.unverified_critical_fields(uuid)
TO legalintel_dataops;

-- Reviewers (data-ops) record verifications and read them; nobody else can, and the columns the
-- database assigns (id, sequence, value, time) are not grantable to a caller.
GRANT SELECT ON corpus.critical_metadata_fields, corpus.version_field_verifications
  TO legalintel_dataops;
GRANT INSERT (version_id, field, status, value_sha256, evidence_reference, verified_by)
  ON corpus.version_field_verifications TO legalintel_dataops;

-- ---------------------------------------------------------------------------------------
-- 3. Provenance must be attested before a version is approved or published.
--
--    The corpus cannot read ingestion tables (ingestion is a later migration set, and the
--    dependency runs the other way), so it cannot check ingestion's evidence itself. Instead it
--    owns a record that ingestion writes ONLY after its own evidence checks have passed, and the
--    approval gate requires that record. The dependency direction is preserved: corpus asks "has
--    provenance been attested?", ingestion answers by writing this row.
--
--    An attestation says that a specific version (its source, its content checksum, its pipeline
--    version) passed a named hand-off protocol, by a named system, at a time the database
--    assigned. It is append-only. A composite foreign key means a forged attestation that names
--    the wrong source, content or pipeline version cannot be recorded at all.
--
--    NO runtime role can insert here. The only writer is ingestion's SECURITY DEFINER function
--    ingestion.attest_provenance(job) (ingestion migration 0002), which derives every value from
--    the evidence it has verified rather than accepting them from its caller. That is what makes
--    "ingestion may attest only after its checks succeed" a property of the database and not a
--    promise of the pipeline code.
-- ---------------------------------------------------------------------------------------
ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_provenance_key
  UNIQUE (id, source_id, content_checksum, pipeline_version);

CREATE TABLE corpus.version_provenance_attestations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence            bigint      GENERATED ALWAYS AS IDENTITY,
  version_id          uuid        NOT NULL,
  source_id           uuid        NOT NULL,
  -- SHA-256 of the acquired file, as recorded on the version.
  content_checksum    bytea       NOT NULL CHECK (length(content_checksum) = 32),
  pipeline_version    text        NOT NULL CHECK (length(pipeline_version) BETWEEN 1 AND 64),
  -- Which hand-off protocol was satisfied, and which revision of it.
  attestation_type    text        NOT NULL CHECK (attestation_type IN ('ingestion_pipeline')),
  attestation_version integer     NOT NULL CHECK (attestation_version >= 1),
  -- An opaque pointer to the attester's own evidence (for ingestion: job, artifact, extraction).
  evidence_reference  text        NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 1 AND 500),
  -- The system that attested, and the person on whose request the version was acquired, if any.
  system_identity     text        NOT NULL CHECK (system_identity ~ '^[a-z][a-z0-9_.:/-]{0,63}$'),
  actor_id            uuid        REFERENCES iam.users (id),
  attested_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, attestation_type, attestation_version),
  CONSTRAINT attestation_matches_version
    FOREIGN KEY (version_id, source_id, content_checksum, pipeline_version)
    REFERENCES corpus.document_versions (id, source_id, content_checksum, pipeline_version)
);

CREATE TRIGGER attestations_no_update BEFORE UPDATE ON corpus.version_provenance_attestations
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER attestations_no_delete BEFORE DELETE ON corpus.version_provenance_attestations
  FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
CREATE TRIGGER attestations_no_truncate BEFORE TRUNCATE ON corpus.version_provenance_attestations
  FOR EACH STATEMENT EXECUTE FUNCTION corpus.reject_mutation();

-- The time is the database's, whoever the writer is: a superuser cannot backdate it either.
CREATE FUNCTION corpus.stamp_attestation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.attested_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER attestations_stamp BEFORE INSERT ON corpus.version_provenance_attestations
  FOR EACH ROW EXECUTE FUNCTION corpus.stamp_attestation();

-- Reviewers and ingestion read attestations; no runtime role writes one (see above).
GRANT SELECT ON corpus.version_provenance_attestations TO legalintel_ingest, legalintel_dataops;

-- ---------------------------------------------------------------------------------------
-- 4. The gate. A version is approved (and, again, published) only when its provenance has been
--    attested AND its publish-critical metadata is human-verified and still matches what was
--    verified. Publication repeats the checks so the chain cannot be bypassed by an approval
--    recorded through another path. Named to sort after versions_review_gate (0003), so
--    transition validity and the recorded review decision are checked first. SECURITY INVOKER:
--    the role that moves a version can read what it consults.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION corpus.enforce_trust_gate() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_unverified text[];
BEGIN
  IF NEW.lifecycle_state IN ('approved', 'published')
     AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF NOT EXISTS (SELECT 1 FROM corpus.version_provenance_attestations a
                    WHERE a.version_id = NEW.id AND a.attestation_type = 'ingestion_pipeline') THEN
      RAISE EXCEPTION 'a version cannot be approved or published until its provenance has been attested'
        USING ERRCODE = 'P0001', HINT = 'corpus.provenance_required';
    END IF;

    v_unverified := corpus.unverified_critical_fields(NEW.id);
    IF cardinality(v_unverified) > 0 THEN
      RAISE EXCEPTION 'publish-critical metadata is not verified by a person: %', array_to_string(v_unverified, ', ')
        USING ERRCODE = 'P0001', HINT = 'corpus.metadata_unverified';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER versions_trust_gate BEFORE UPDATE ON corpus.document_versions
  FOR EACH ROW EXECUTE FUNCTION corpus.enforce_trust_gate();
