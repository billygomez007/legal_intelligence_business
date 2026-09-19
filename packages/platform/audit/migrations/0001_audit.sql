-- Append-only audit trail. Design: docs/adr/0005-authentication-and-authorization.md.
--
-- Two tables:
--   audit.events           tenant-scoped (standard RLS): what happened inside an organization.
--   audit.platform_events  not tenant-scoped: what operators and pipelines did to shared data
--                          (publishing corpus content, changing source rights).
--
-- Append-only is enforced twice: runtime roles hold no UPDATE/DELETE/TRUNCATE privilege, and
-- triggers reject those statements for everyone, including the table owner and superusers.
-- Metadata carries identifiers and outcomes only, never content (docs/17_SECURITY_PRIVACY.md);
-- the application validates this and the database bounds its size.

CREATE SCHEMA audit;

CREATE FUNCTION audit.reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only'
    USING ERRCODE = '42501', HINT = 'audit.append_only';
END
$$;

CREATE TABLE audit.events (
  organization_id uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_kind      text        NOT NULL CHECK (actor_kind IN ('user', 'api_key', 'system')),
  actor_id        text        CHECK (length(actor_id) <= 128),
  action          text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.:-]{0,98}[a-z0-9]$'),
  outcome         text        NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  resource_type   text        CHECK (resource_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  resource_id     text        CHECK (length(resource_id) <= 128),
  request_id      text        CHECK (length(request_id) <= 128),
  metadata        jsonb       NOT NULL DEFAULT '{}'
                              CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096),
  PRIMARY KEY (organization_id, id)
);
CREATE INDEX audit_events_org_time_idx ON audit.events (organization_id, occurred_at DESC);
CREATE INDEX audit_events_org_action_idx ON audit.events (organization_id, action, occurred_at DESC);
CALL app.enable_tenant_rls('audit.events');

CREATE TABLE audit.platform_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_kind    text        NOT NULL CHECK (actor_kind IN ('user', 'api_key', 'system')),
  actor_id      text        CHECK (length(actor_id) <= 128),
  action        text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.:-]{0,98}[a-z0-9]$'),
  outcome       text        NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  resource_type text        CHECK (resource_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  resource_id   text        CHECK (length(resource_id) <= 128),
  request_id    text        CHECK (length(request_id) <= 128),
  metadata      jsonb       NOT NULL DEFAULT '{}'
                            CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096)
);
CREATE INDEX audit_platform_events_time_idx ON audit.platform_events (occurred_at DESC);

CREATE TRIGGER events_no_update BEFORE UPDATE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER events_no_delete BEFORE DELETE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON audit.events
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER platform_events_no_update BEFORE UPDATE ON audit.platform_events
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER platform_events_no_delete BEFORE DELETE ON audit.platform_events
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER platform_events_no_truncate BEFORE TRUNCATE ON audit.platform_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

GRANT USAGE ON SCHEMA audit TO legalintel_app, legalintel_ingest, legalintel_dataops;

-- Append and read. Never update, delete or truncate.
GRANT SELECT, INSERT ON audit.events TO legalintel_app;

-- Operators and pipelines record what they do to shared data. Only data-ops can read it back.
-- The end-user API is deliberately absent: it has no operator actions to record, and granting
-- it INSERT would let a compromised request handler forge entries in the operator trail. Add it
-- back, with a reason, if a concrete need arises.
GRANT INSERT ON audit.platform_events TO legalintel_ingest, legalintel_dataops;
GRANT SELECT ON audit.platform_events TO legalintel_dataops;
