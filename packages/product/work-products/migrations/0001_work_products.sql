CREATE SCHEMA work_products;

REVOKE ALL ON SCHEMA work_products FROM PUBLIC;

-- =====================================================================
-- Aggregate
-- =====================================================================

CREATE TABLE work_products.work_products (
  organization_id       uuid        NOT NULL,
  id                    uuid        NOT NULL,
  ai_task_id             uuid        NOT NULL,
  matter_id              uuid,
  title                  text        NOT NULL,
  kind                   text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'draft',
  current_revision_id    uuid,
  submitted_revision_id  uuid,
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  archived_at            timestamptz,

  PRIMARY KEY (organization_id, id),

  CONSTRAINT work_products_title_valid
    CHECK (
      length(btrim(title)) BETWEEN 1 AND 300
      AND title = btrim(title)
    ),

  CONSTRAINT work_products_kind_valid
    CHECK (
      kind ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'
      OR kind ~ '^[a-z]$'
    ),

  CONSTRAINT work_products_status_valid
    CHECK (
      status IN (
        'draft',
        'submitted',
        'approved',
        'rejected',
        'archived'
      )
    ),

  CONSTRAINT work_products_archive_shape
    CHECK (
      (status = 'archived' AND archived_at IS NOT NULL)
      OR
      (status <> 'archived' AND archived_at IS NULL)
    ),

  CONSTRAINT work_products_submission_shape
    CHECK (
      (status = 'submitted' AND submitted_revision_id IS NOT NULL)
      OR status <> 'submitted'
    ),

  CONSTRAINT work_products_task_fk
    FOREIGN KEY (organization_id, ai_task_id)
    REFERENCES ai_tasks.tasks (organization_id, id),

  CONSTRAINT work_products_matter_fk
    FOREIGN KEY (organization_id, matter_id)
    REFERENCES workspace.matters (organization_id, id),

  CONSTRAINT work_products_created_by_fk
    FOREIGN KEY (created_by)
    REFERENCES iam.users (id)
);

CREATE INDEX work_products_by_task
  ON work_products.work_products
  (organization_id, ai_task_id, created_at DESC);

CREATE INDEX work_products_by_matter
  ON work_products.work_products
  (organization_id, matter_id, created_at DESC)
  WHERE matter_id IS NOT NULL;


-- =====================================================================
-- Immutable content revisions
-- =====================================================================

CREATE TABLE work_products.revisions (
  organization_id       uuid        NOT NULL,
  id                    uuid        NOT NULL,
  work_product_id       uuid        NOT NULL,
  revision_number       integer     NOT NULL,
  task_scope_revision   integer     NOT NULL,
  previous_revision_id  uuid,
  content               text        NOT NULL,
  content_format        text        NOT NULL,
  content_sha256        text        NOT NULL,
  revision_sha256       text        NOT NULL,
  created_by            uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, id),

  CONSTRAINT work_product_revision_number_positive
    CHECK (revision_number > 0),

  CONSTRAINT work_product_scope_revision_positive
    CHECK (task_scope_revision > 0),

  CONSTRAINT work_product_revision_content_nonempty
    CHECK (
      length(content) > 0
      AND octet_length(content) <= 1048576
      AND position(chr(0) IN content) = 0
    ),

  CONSTRAINT work_product_revision_format_valid
    CHECK (content_format IN ('plain_text', 'markdown')),

  CONSTRAINT work_product_content_sha256_valid
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT work_product_revision_sha256_valid
    CHECK (revision_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT work_product_revision_parent_fk
    FOREIGN KEY (organization_id, work_product_id)
    REFERENCES work_products.work_products (organization_id, id),

  CONSTRAINT work_product_revision_previous_fk
    FOREIGN KEY (organization_id, previous_revision_id)
    REFERENCES work_products.revisions (organization_id, id),

  CONSTRAINT work_product_revision_created_by_fk
    FOREIGN KEY (created_by)
    REFERENCES iam.users (id),

  CONSTRAINT work_product_revision_number_unique
    UNIQUE (organization_id, work_product_id, revision_number),

  CONSTRAINT work_product_revision_hash_unique
    UNIQUE (organization_id, work_product_id, revision_sha256)
);

CREATE INDEX work_product_revisions_by_product
  ON work_products.revisions
  (organization_id, work_product_id, revision_number DESC);


-- =====================================================================
-- Immutable provenance references
-- =====================================================================

CREATE TABLE work_products.revision_provenance (
  organization_id  uuid        NOT NULL,
  revision_id      uuid        NOT NULL,
  ordinal          integer     NOT NULL,
  source_kind      text        NOT NULL,
  source_id        uuid        NOT NULL,
  version_id       uuid        NOT NULL,
  locator          text,
  recorded_by      uuid        NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, revision_id, ordinal),

  CONSTRAINT work_product_provenance_ordinal_nonnegative
    CHECK (ordinal >= 0 AND ordinal < 100),

  CONSTRAINT work_product_provenance_kind_valid
    CHECK (
      source_kind IN (
        'matter_document_version',
        'knowledge_source_version',
        'corpus_document_version'
      )
    ),

  CONSTRAINT work_product_provenance_locator_valid
    CHECK (
      locator IS NULL
      OR (
        length(locator) BETWEEN 1 AND 512
        AND locator = btrim(locator)
        AND position(chr(0) IN locator) = 0
      )
    ),

  CONSTRAINT work_product_provenance_revision_fk
    FOREIGN KEY (organization_id, revision_id)
    REFERENCES work_products.revisions (organization_id, id),

  CONSTRAINT work_product_provenance_recorded_by_fk
    FOREIGN KEY (recorded_by)
    REFERENCES iam.users (id)
);

CREATE INDEX work_product_provenance_by_source
  ON work_products.revision_provenance
  (source_kind, source_id, version_id);


-- =====================================================================
-- Immutable human review ledger
-- =====================================================================

CREATE TABLE work_products.reviews (
  organization_id  uuid        NOT NULL,
  id               uuid        NOT NULL,
  work_product_id  uuid        NOT NULL,
  revision_id      uuid        NOT NULL,
  decision         text        NOT NULL,
  reason           text,
  decided_by       uuid        NOT NULL,
  decided_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, id),

  CONSTRAINT work_product_review_decision_valid
    CHECK (decision IN ('approved', 'rejected')),

  CONSTRAINT work_product_rejection_reason_required
    CHECK (
      decision <> 'rejected'
      OR (
        reason IS NOT NULL
        AND length(btrim(reason)) BETWEEN 1 AND 2000
      )
    ),

  CONSTRAINT work_product_review_reason_valid
    CHECK (
      reason IS NULL
      OR (
        length(reason) <= 2000
        AND position(chr(0) IN reason) = 0
      )
    ),

  CONSTRAINT work_product_review_product_fk
    FOREIGN KEY (organization_id, work_product_id)
    REFERENCES work_products.work_products (organization_id, id),

  CONSTRAINT work_product_review_revision_fk
    FOREIGN KEY (organization_id, revision_id)
    REFERENCES work_products.revisions (organization_id, id),

  CONSTRAINT work_product_review_decided_by_fk
    FOREIGN KEY (decided_by)
    REFERENCES iam.users (id)
);

CREATE INDEX work_product_reviews_by_revision
  ON work_products.reviews
  (organization_id, revision_id, decided_at DESC);


-- =====================================================================
-- Aggregate pointer integrity
-- =====================================================================

ALTER TABLE work_products.work_products
  ADD CONSTRAINT work_products_current_revision_fk
  FOREIGN KEY (organization_id, current_revision_id)
  REFERENCES work_products.revisions (organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE work_products.work_products
  ADD CONSTRAINT work_products_submitted_revision_fk
  FOREIGN KEY (organization_id, submitted_revision_id)
  REFERENCES work_products.revisions (organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;


CREATE FUNCTION work_products.guard_revision_pointers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_product uuid;
BEGIN
  IF NEW.current_revision_id IS NOT NULL THEN
    SELECT r.work_product_id
      INTO v_product
      FROM work_products.revisions r
     WHERE r.organization_id = NEW.organization_id
       AND r.id = NEW.current_revision_id;

    IF v_product IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'current revision belongs to another work product'
        USING ERRCODE = '23514',
              HINT = 'work_products.current_revision_mismatch';
    END IF;
  END IF;

  IF NEW.submitted_revision_id IS NOT NULL THEN
    SELECT r.work_product_id
      INTO v_product
      FROM work_products.revisions r
     WHERE r.organization_id = NEW.organization_id
       AND r.id = NEW.submitted_revision_id;

    IF v_product IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'submitted revision belongs to another work product'
        USING ERRCODE = '23514',
              HINT = 'work_products.submitted_revision_mismatch';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION work_products.guard_revision_pointers()
FROM PUBLIC;

CREATE TRIGGER work_products_guard_revision_pointers
BEFORE INSERT OR UPDATE
ON work_products.work_products
FOR EACH ROW
EXECUTE FUNCTION work_products.guard_revision_pointers();


-- =====================================================================
-- Immutable ledgers
-- =====================================================================

CREATE FUNCTION work_products.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'work product history is immutable'
    USING ERRCODE = '42501',
          HINT = 'work_products.immutable_history';
END
$$;

REVOKE ALL ON FUNCTION work_products.reject_immutable_change()
FROM PUBLIC;


CREATE TRIGGER work_product_revision_reject_update
BEFORE UPDATE ON work_products.revisions
FOR EACH ROW
EXECUTE FUNCTION work_products.reject_immutable_change();

CREATE TRIGGER work_product_revision_reject_delete
BEFORE DELETE ON work_products.revisions
FOR EACH ROW
EXECUTE FUNCTION work_products.reject_immutable_change();

CREATE TRIGGER work_product_provenance_reject_update
BEFORE UPDATE ON work_products.revision_provenance
FOR EACH ROW
EXECUTE FUNCTION work_products.reject_immutable_change();

CREATE TRIGGER work_product_provenance_reject_delete
BEFORE DELETE ON work_products.revision_provenance
FOR EACH ROW
EXECUTE FUNCTION work_products.reject_immutable_change();

CREATE TRIGGER work_product_review_reject_update
BEFORE UPDATE ON work_products.reviews
FOR EACH ROW
EXECUTE FUNCTION work_products.reject_immutable_change();

CREATE TRIGGER work_product_review_reject_delete
BEFORE DELETE ON work_products.reviews
FOR EACH ROW
EXECUTE FUNCTION work_products.reject_immutable_change();


-- =====================================================================
-- Tenant isolation
-- =====================================================================

CALL app.enable_tenant_rls(
  'work_products.work_products'::regclass
);

CALL app.enable_tenant_rls(
  'work_products.revisions'::regclass
);

CALL app.enable_tenant_rls(
  'work_products.revision_provenance'::regclass
);

CALL app.enable_tenant_rls(
  'work_products.reviews'::regclass
);


-- =====================================================================
-- Runtime privileges
-- =====================================================================

GRANT USAGE ON SCHEMA work_products
TO legalintel_app;

REVOKE ALL ON work_products.work_products FROM PUBLIC;
REVOKE ALL ON work_products.revisions FROM PUBLIC;
REVOKE ALL ON work_products.revision_provenance FROM PUBLIC;
REVOKE ALL ON work_products.reviews FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE
ON work_products.work_products
TO legalintel_app;

GRANT SELECT, INSERT
ON work_products.revisions
TO legalintel_app;

GRANT SELECT, INSERT
ON work_products.revision_provenance
TO legalintel_app;

GRANT SELECT, INSERT
ON work_products.reviews
TO legalintel_app;

-- No grants are made to legalintel_ingest or legalintel_dataops.
-- Work Product history is tenant application data.
