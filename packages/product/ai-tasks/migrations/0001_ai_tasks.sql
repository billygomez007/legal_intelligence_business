CREATE SCHEMA IF NOT EXISTS ai_tasks;

REVOKE ALL ON SCHEMA ai_tasks FROM PUBLIC;
GRANT USAGE ON SCHEMA ai_tasks TO legalintel_app;

-- Phase 6 stores task definitions and authorization scope only.
-- It deliberately does not execute models, retrieve documents, create work products,
-- or perform external actions.
CREATE TABLE ai_tasks.tasks (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  employee_type text NOT NULL,
  title text NOT NULL,
  instructions text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  current_scope_revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT ai_tasks_tasks_pkey
    PRIMARY KEY (organization_id, id),

  CONSTRAINT ai_tasks_tasks_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES iam.organizations(id),

  CONSTRAINT ai_tasks_tasks_requester_fkey
    FOREIGN KEY (requested_by_user_id)
    REFERENCES iam.users(id),

  CONSTRAINT ai_tasks_tasks_employee_type_check
    CHECK (
      employee_type IN (
        'research_associate',
        'ai_paralegal',
        'matter_manager',
        'contract_analyst'
      )
    ),

  CONSTRAINT ai_tasks_tasks_title_nonblank
    CHECK (btrim(title) <> ''),

  CONSTRAINT ai_tasks_tasks_instructions_nonblank
    CHECK (btrim(instructions) <> ''),

  CONSTRAINT ai_tasks_tasks_status_check
    CHECK (status IN ('draft', 'ready', 'cancelled')),

  CONSTRAINT ai_tasks_tasks_scope_revision_positive
    CHECK (current_scope_revision > 0)
);

CREATE INDEX ai_tasks_tasks_status_idx
  ON ai_tasks.tasks (
    organization_id,
    status,
    created_at DESC
  );

CREATE INDEX ai_tasks_tasks_requester_idx
  ON ai_tasks.tasks (
    organization_id,
    requested_by_user_id,
    created_at DESC
  );

-- Scope revisions are append-only intent snapshots. Every mode includes the Ghana
-- Legal Corpus. Firm Knowledge and a selected Matter are additive private scopes.
-- The canonical jurisdiction id is resolved server-side; jurisdiction_code is a
-- fail-closed product guard that prevents this phase from persisting another country.
CREATE TABLE ai_tasks.task_scope_revisions (
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL,
  revision integer NOT NULL,
  jurisdiction_id uuid NOT NULL,
  jurisdiction_code text NOT NULL DEFAULT 'GH',
  scope_mode text NOT NULL,
  matter_id uuid NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT ai_tasks_task_scope_revisions_pkey
    PRIMARY KEY (
      organization_id,
      task_id,
      revision
    ),

  CONSTRAINT ai_tasks_task_scope_revisions_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES iam.organizations(id),

  CONSTRAINT ai_tasks_task_scope_revisions_task_fkey
    FOREIGN KEY (organization_id, task_id)
    REFERENCES ai_tasks.tasks(organization_id, id),

  CONSTRAINT ai_tasks_task_scope_revisions_jurisdiction_fkey
    FOREIGN KEY (jurisdiction_id)
    REFERENCES corpus.jurisdictions(id),

  CONSTRAINT ai_tasks_task_scope_revisions_matter_fkey
    FOREIGN KEY (organization_id, matter_id)
    REFERENCES workspace.matters(organization_id, id),

  CONSTRAINT ai_tasks_task_scope_revisions_creator_fkey
    FOREIGN KEY (created_by_user_id)
    REFERENCES iam.users(id),

  CONSTRAINT ai_tasks_task_scope_revisions_revision_positive
    CHECK (revision > 0),

  CONSTRAINT ai_tasks_task_scope_revisions_ghana_only
    CHECK (jurisdiction_code = 'GH'),

  CONSTRAINT ai_tasks_task_scope_revisions_mode_check
    CHECK (
      scope_mode IN (
        'ghana_corpus',
        'ghana_corpus_and_firm_knowledge',
        'ghana_corpus_and_matter',
        'ghana_corpus_and_matter_and_firm_knowledge'
      )
    ),

  CONSTRAINT ai_tasks_task_scope_revisions_matter_shape_check
    CHECK (
      (
        scope_mode IN (
          'ghana_corpus_and_matter',
          'ghana_corpus_and_matter_and_firm_knowledge'
        )
        AND matter_id IS NOT NULL
      )
      OR
      (
        scope_mode IN (
          'ghana_corpus',
          'ghana_corpus_and_firm_knowledge'
        )
        AND matter_id IS NULL
      )
    )
);

CREATE INDEX ai_tasks_task_scope_revisions_task_idx
  ON ai_tasks.task_scope_revisions (
    organization_id,
    task_id,
    revision DESC
  );

CREATE INDEX ai_tasks_task_scope_revisions_matter_idx
  ON ai_tasks.task_scope_revisions (
    organization_id,
    matter_id,
    created_at DESC
  )
  WHERE matter_id IS NOT NULL;

-- A task always points at an existing immutable scope revision. The constraint is
-- deferred so creation can insert the task and its first revision in one transaction.
ALTER TABLE ai_tasks.tasks
  ADD CONSTRAINT ai_tasks_tasks_current_scope_fkey
  FOREIGN KEY (
    organization_id,
    id,
    current_scope_revision
  )
  REFERENCES ai_tasks.task_scope_revisions(
    organization_id,
    task_id,
    revision
  )
  DEFERRABLE INITIALLY DEFERRED;

-- Task identity, requester and employee type are immutable. Definition and scope may
-- change only while draft. Ready tasks can only be cancelled; cancelled tasks are frozen.
CREATE FUNCTION ai_tasks.guard_task_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.employee_type IS DISTINCT FROM OLD.employee_type THEN
    RAISE EXCEPTION 'AI task identity is immutable'
      USING HINT = 'ai_tasks.identity_immutable';
  END IF;

  IF NEW.current_scope_revision < OLD.current_scope_revision THEN
    RAISE EXCEPTION 'AI task scope revision cannot move backwards'
      USING HINT = 'ai_tasks.scope_revision_regression';
  END IF;

  IF OLD.status = 'ready' THEN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.instructions IS DISTINCT FROM OLD.instructions
       OR NEW.current_scope_revision IS DISTINCT FROM OLD.current_scope_revision THEN
      RAISE EXCEPTION 'ready AI task definition is frozen'
        USING HINT = 'ai_tasks.ready_definition_frozen';
    END IF;

    IF NEW.status NOT IN ('ready', 'cancelled') THEN
      RAISE EXCEPTION 'ready AI task may only remain ready or be cancelled'
        USING HINT = 'ai_tasks.invalid_status_transition';
    END IF;
  END IF;

  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'cancelled AI task is immutable'
      USING HINT = 'ai_tasks.cancelled_immutable';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_tasks_tasks_guard_update
BEFORE UPDATE ON ai_tasks.tasks
FOR EACH ROW
EXECUTE FUNCTION ai_tasks.guard_task_update();

-- New scope revisions are accepted only while the parent task is still draft.
CREATE FUNCTION ai_tasks.guard_scope_revision_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_revision integer;
  latest_revision integer;
BEGIN
  SELECT status, current_scope_revision
    INTO parent_status, parent_revision
    FROM ai_tasks.tasks
   WHERE organization_id = NEW.organization_id
     AND id = NEW.task_id
   FOR UPDATE;

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'AI task does not exist'
      USING HINT = 'ai_tasks.task_not_found';
  END IF;

  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'AI task scope may change only while draft'
      USING HINT = 'ai_tasks.scope_frozen';
  END IF;

  -- The product code and canonical registry identity must describe the same jurisdiction.
  -- A literal GH label alone must never bless an arbitrary registry id.
  IF NOT EXISTS (
    SELECT 1 FROM corpus.jurisdictions j
     WHERE j.id = NEW.jurisdiction_id AND j.code = 'GH' AND NOT j.is_synthetic
  ) THEN
    RAISE EXCEPTION 'AI task requires the canonical Ghana jurisdiction'
      USING HINT = 'ai_tasks.jurisdiction_invalid';
  END IF;

  -- Allocate against actual immutable history, never a mutable pointer supplied by SQL.
  -- The parent lock serializes concurrent appenders.
  SELECT coalesce(max(revision), 0) INTO latest_revision
    FROM ai_tasks.task_scope_revisions
   WHERE organization_id = NEW.organization_id AND task_id = NEW.task_id;
  IF NEW.revision <> latest_revision + 1 THEN
    RAISE EXCEPTION 'AI task scope revisions must be sequential starting at one'
      USING HINT = 'ai_tasks.invalid_scope_revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_tasks_scope_revision_guard_insert
BEFORE INSERT ON ai_tasks.task_scope_revisions
FOR EACH ROW
EXECUTE FUNCTION ai_tasks.guard_scope_revision_insert();

-- The deferred FK proves existence; this also proves the pointer reaches the latest
-- committed history. Appending history and advancing the pointer are one atomic change.
CREATE FUNCTION ai_tasks.guard_current_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_tasks.tasks t
     WHERE t.organization_id = NEW.organization_id AND t.id = NEW.task_id
       AND t.current_scope_revision <> (
         SELECT max(s.revision) FROM ai_tasks.task_scope_revisions s
          WHERE s.organization_id = t.organization_id AND s.task_id = t.id
       )
  ) THEN
    RAISE EXCEPTION 'AI task must point to its latest scope revision'
      USING HINT = 'ai_tasks.scope_pointer_invalid';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ai_tasks_current_scope_check
AFTER INSERT ON ai_tasks.task_scope_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_tasks.guard_current_scope();

-- Scope history is append-only even for callers that later receive broader table rights.
CREATE FUNCTION ai_tasks.reject_scope_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI task scope revisions are immutable'
    USING HINT = 'ai_tasks.scope_revision_immutable';
END;
$$;

CREATE TRIGGER ai_tasks_scope_revision_reject_update
BEFORE UPDATE ON ai_tasks.task_scope_revisions
FOR EACH ROW
EXECUTE FUNCTION ai_tasks.reject_scope_revision_mutation();

CREATE TRIGGER ai_tasks_scope_revision_reject_delete
BEFORE DELETE ON ai_tasks.task_scope_revisions
FOR EACH ROW
EXECUTE FUNCTION ai_tasks.reject_scope_revision_mutation();

CALL app.enable_tenant_rls('ai_tasks.tasks'::regclass);
CALL app.enable_tenant_rls('ai_tasks.task_scope_revisions'::regclass);

REVOKE ALL ON ai_tasks.tasks FROM PUBLIC;
REVOKE ALL ON ai_tasks.task_scope_revisions FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE
  ON ai_tasks.tasks
  TO legalintel_app;

GRANT SELECT, INSERT
  ON ai_tasks.task_scope_revisions
  TO legalintel_app;
