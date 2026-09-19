-- Platform foundation: schemas, extensions and the tenant-context primitives that every
-- tenant-owned table builds on. Design rationale: docs/adr/0004-tenancy-and-row-level-security.md.
--
-- Roles (legalintel_migrator/app/ingest/dataops) are provisioned by `db:bootstrap`, not here.
-- The runner refuses to start if they are missing.

CREATE SCHEMA app;
COMMENT ON SCHEMA app IS
  'Session-context helpers and row-level-security utilities. Contains no tables.';

CREATE SCHEMA IF NOT EXISTS ops;
COMMENT ON SCHEMA ops IS
  'Operational metadata such as migration history. Never granted to runtime roles.';

-- Trusted extensions: installable by the database owner without superuser.
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email/slug columns
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy matching for names and citations
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints over date ranges

-- Functions are executable by PUBLIC unless revoked. Make "no access until granted" the
-- default for everything the migrator creates from here on.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------
-- Tenant context
--
-- The application sets these per transaction with set_config(name, value, true) (see
-- withTenantTransaction). They are NULL when unset, blank, or malformed, so a missing or
-- corrupt context matches no rows. Failing closed is the requirement; erroring would also be
-- safe but makes "forgot to set a tenant" indistinguishable from an outage.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.org_id', true)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.org_id', true)::uuid
  END
$$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.user_id', true)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.user_id', true)::uuid
  END
$$;

GRANT USAGE ON SCHEMA app TO legalintel_app, legalintel_ingest, legalintel_dataops;
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_user_id()
  TO legalintel_app, legalintel_ingest, legalintel_dataops;

-- ---------------------------------------------------------------------------------------
-- app.enable_tenant_rls(table)
--
-- The one place tenant isolation is defined. Every table with an organization_id column
-- calls this in the migration that creates it; a guardrail test fails the build if any
-- such table does not.
--
--   * ENABLE + FORCE row level security: FORCE subjects the table owner as well.
--   * tenant_isolation is RESTRICTIVE. Restrictive policies are ANDed with every other
--     policy, so a permissive policy added later (say, "USING (true)" for a new role) can
--     never widen access across tenants. A permissive-only design is one careless policy
--     away from a cross-tenant leak.
--   * runtime_access is the permissive grant that lets the application role see rows at all;
--     RLS denies everything until at least one permissive policy matches.
-- ---------------------------------------------------------------------------------------
CREATE PROCEDURE app.enable_tenant_rls(target regclass)
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = target
       AND attname = 'organization_id'
       AND attnotnull
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '% must have a NOT NULL organization_id column to be tenant-scoped', target;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);

  -- (SELECT ...) makes the planner evaluate the context once per statement, not per row.
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS RESTRICTIVE FOR ALL TO PUBLIC
       USING (organization_id = (SELECT app.current_org_id()))
       WITH CHECK (organization_id = (SELECT app.current_org_id()))',
    target);

  EXECUTE format(
    'CREATE POLICY runtime_access ON %s AS PERMISSIVE FOR ALL TO legalintel_app
       USING (true) WITH CHECK (true)',
    target);
END
$$;

REVOKE ALL ON PROCEDURE app.enable_tenant_rls(regclass) FROM PUBLIC;
