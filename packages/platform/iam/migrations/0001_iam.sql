-- Identity, organizations (tenants), memberships, roles and API keys.
-- Design: docs/adr/0004-tenancy-and-row-level-security.md, docs/adr/0005-authentication-and-authorization.md.
--
-- Access model:
--   * users, identities: global (a person may belong to many organizations).
--   * organizations: the tenant root. Visible to its members.
--   * memberships: a user's own rows are visible in every organization (for the workspace
--     switcher); all writes are confined to the current organization.
--   * role_assignments, api_keys: standard tenant tables (app.enable_tenant_rls).
--   * SECURITY DEFINER functions are the ONLY way to cross tenant boundaries, each narrow,
--     each pinning search_path, each acting inside a tenant context so RLS still applies.

CREATE SCHEMA iam;

-- ---------------------------------------------------------------------------------------
-- Global identity
-- ---------------------------------------------------------------------------------------
CREATE TABLE iam.users (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext      NOT NULL UNIQUE CHECK (length(email::text) BETWEEN 3 AND 320),
  display_name text        NOT NULL DEFAULT '' CHECK (length(display_name) <= 200),
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.identities (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES iam.users (id),
  provider   text        NOT NULL CHECK (provider ~ '^[a-z0-9_.-]{1,64}$'),
  subject    text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX identities_user_id_idx ON iam.identities (user_id);

-- ---------------------------------------------------------------------------------------
-- Tenant root
-- ---------------------------------------------------------------------------------------
CREATE TABLE iam.organizations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slug       citext      NOT NULL UNIQUE CHECK (slug::text ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind       text        NOT NULL CHECK (kind IN ('individual', 'firm', 'corporate', 'institution')),
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------
-- Tenant-owned
-- ---------------------------------------------------------------------------------------
CREATE TABLE iam.memberships (
  organization_id uuid        NOT NULL REFERENCES iam.organizations (id),
  user_id         uuid        NOT NULL REFERENCES iam.users (id),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_id_idx ON iam.memberships (user_id);

CREATE TABLE iam.role_assignments (
  organization_id uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  role_key        text        NOT NULL CHECK (role_key IN ('owner', 'admin', 'member', 'viewer')),
  granted_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, role_key),
  -- Composite: a role can only be assigned to a member of the SAME organization.
  FOREIGN KEY (organization_id, user_id) REFERENCES iam.memberships (organization_id, user_id),
  FOREIGN KEY (organization_id, granted_by) REFERENCES iam.memberships (organization_id, user_id)
);

CREATE TABLE iam.api_keys (
  organization_id uuid        NOT NULL REFERENCES iam.organizations (id),
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  -- SHA-256 of the secret. Keys are 256 bits of randomness, so a fast hash is sufficient and
  -- a stolen table cannot be brute-forced. The secret itself is never stored.
  secret_hash     bytea       NOT NULL CHECK (length(secret_hash) = 32),
  last_four       text        NOT NULL CHECK (length(last_four) = 4),
  scopes          text[]      NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 100),
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES iam.memberships (organization_id, user_id)
);

-- Platform staff (data operations, rights management). Global; written only by operators.
CREATE TABLE iam.platform_role_assignments (
  user_id    uuid        NOT NULL REFERENCES iam.users (id),
  role_key   text        NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  granted_by uuid        REFERENCES iam.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_key)
);

-- ---------------------------------------------------------------------------------------
-- Row-level security
-- Definer functions run as the migrator (the owner), which FORCE RLS also constrains, so the
-- owner gets an explicit permissive policy. The restrictive tenant policy still ANDs in.
-- ---------------------------------------------------------------------------------------
ALTER TABLE iam.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_read ON iam.users FOR SELECT TO legalintel_app
  USING (
    id = (SELECT app.current_user_id())
    OR EXISTS (
      SELECT 1 FROM iam.memberships m
       WHERE m.user_id = users.id AND m.organization_id = (SELECT app.current_org_id())
    )
  );
CREATE POLICY users_update_self ON iam.users FOR UPDATE TO legalintel_app
  USING (id = (SELECT app.current_user_id()))
  WITH CHECK (id = (SELECT app.current_user_id()));
CREATE POLICY users_owner ON iam.users FOR ALL TO legalintel_migrator USING (true) WITH CHECK (true);

ALTER TABLE iam.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.identities FORCE ROW LEVEL SECURITY;
-- No policy for runtime roles: identities are reachable only through definer functions.
CREATE POLICY identities_owner ON iam.identities FOR ALL TO legalintel_migrator USING (true) WITH CHECK (true);

ALTER TABLE iam.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_read ON iam.organizations FOR SELECT TO legalintel_app
  USING (
    id = (SELECT app.current_org_id())
    OR EXISTS (
      SELECT 1 FROM iam.memberships m
       WHERE m.organization_id = organizations.id
         AND m.user_id = (SELECT app.current_user_id())
         AND m.status = 'active'
    )
  );
CREATE POLICY org_update ON iam.organizations FOR UPDATE TO legalintel_app
  USING (id = (SELECT app.current_org_id()))
  WITH CHECK (id = (SELECT app.current_org_id()));
CREATE POLICY org_owner ON iam.organizations FOR ALL TO legalintel_migrator USING (true) WITH CHECK (true);

-- memberships: the one tenant table with a deliberately different policy. A user must be able
-- to list their OWN memberships across organizations (the workspace switcher), but every write
-- is confined to the current organization. Recorded as a guardrail exemption with this reason.
ALTER TABLE iam.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_scope_select ON iam.memberships AS RESTRICTIVE FOR SELECT TO PUBLIC
  USING (
    organization_id = (SELECT app.current_org_id())
    OR user_id = (SELECT app.current_user_id())
  );
CREATE POLICY membership_scope_insert ON iam.memberships AS RESTRICTIVE FOR INSERT TO PUBLIC
  WITH CHECK (organization_id = (SELECT app.current_org_id()));
CREATE POLICY membership_scope_update ON iam.memberships AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (organization_id = (SELECT app.current_org_id()))
  WITH CHECK (organization_id = (SELECT app.current_org_id()));
CREATE POLICY membership_scope_delete ON iam.memberships AS RESTRICTIVE FOR DELETE TO PUBLIC
  USING (organization_id = (SELECT app.current_org_id()));
CREATE POLICY runtime_access ON iam.memberships AS PERMISSIVE FOR ALL TO legalintel_app
  USING (true) WITH CHECK (true);
CREATE POLICY definer_access ON iam.memberships AS PERMISSIVE FOR ALL TO legalintel_migrator
  USING (true) WITH CHECK (true);

CALL app.enable_tenant_rls('iam.role_assignments');
CREATE POLICY definer_access ON iam.role_assignments AS PERMISSIVE FOR ALL TO legalintel_migrator
  USING (true) WITH CHECK (true);
CALL app.enable_tenant_rls('iam.api_keys');

ALTER TABLE iam.platform_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.platform_role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_read_own ON iam.platform_role_assignments FOR SELECT TO legalintel_app
  USING (user_id = (SELECT app.current_user_id()));

-- ---------------------------------------------------------------------------------------
-- Privileges. Explicit, minimal, column-level where a table is only partly writable.
-- Never TRUNCATE, TRIGGER or REFERENCES (guardrail-enforced).
-- ---------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA iam TO legalintel_app;

GRANT SELECT ON iam.users TO legalintel_app;
GRANT UPDATE (display_name, updated_at) ON iam.users TO legalintel_app;

GRANT SELECT ON iam.organizations TO legalintel_app;
GRANT UPDATE (name, updated_at) ON iam.organizations TO legalintel_app;

GRANT SELECT, INSERT ON iam.memberships TO legalintel_app;
GRANT UPDATE (status, updated_at) ON iam.memberships TO legalintel_app;

GRANT SELECT, INSERT, DELETE ON iam.role_assignments TO legalintel_app;

GRANT SELECT, INSERT ON iam.api_keys TO legalintel_app;
GRANT UPDATE (revoked_at, last_used_at) ON iam.api_keys TO legalintel_app;

GRANT SELECT ON iam.platform_role_assignments TO legalintel_app;

-- ---------------------------------------------------------------------------------------
-- An organization must never lose its last active owner: it would be locked out of its own
-- data with no one able to fix it. The organization row is locked first so that two owners
-- removing each other concurrently are serialised instead of both succeeding.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION iam.enforce_last_owner() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_org uuid;
  target_user uuid;
BEGIN
  IF TG_TABLE_NAME = 'role_assignments' THEN
    IF OLD.role_key <> 'owner' THEN
      RETURN OLD;
    END IF;
    target_org := OLD.organization_id;
    target_user := OLD.user_id;
  ELSE
    IF OLD.status <> 'active' OR NEW.status = 'active' THEN
      RETURN NEW;
    END IF;
    target_org := OLD.organization_id;
    target_user := OLD.user_id;
  END IF;

  PERFORM 1 FROM iam.organizations WHERE id = target_org FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
      FROM iam.role_assignments r
      JOIN iam.memberships m
        ON m.organization_id = r.organization_id AND m.user_id = r.user_id
     WHERE r.organization_id = target_org
       AND r.role_key = 'owner'
       AND m.status = 'active'
       AND r.user_id <> target_user
  ) THEN
    RAISE EXCEPTION 'organization must keep at least one active owner'
      USING ERRCODE = 'P0001', HINT = 'org.last_owner';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_assignments_keep_owner
  BEFORE DELETE ON iam.role_assignments
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_last_owner();
CREATE TRIGGER memberships_keep_owner
  BEFORE UPDATE OF status ON iam.memberships
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_last_owner();

-- ---------------------------------------------------------------------------------------
-- SECURITY DEFINER functions. Each pins search_path, does one narrow thing, and checks who
-- is calling from the transaction context rather than trusting an argument.
-- ---------------------------------------------------------------------------------------

-- First sign-in. Deliberately does NOT link a new identity to an existing user by email:
-- automatic linking lets anyone who controls an identity at any provider take over an
-- existing account. A second identity for the same email is a conflict that a verified
-- account-linking flow must resolve.
CREATE FUNCTION iam.provision_user(
  p_provider text, p_subject text, p_email text, p_display_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT i.user_id INTO v_user
    FROM iam.identities i WHERE i.provider = p_provider AND i.subject = p_subject;
  IF v_user IS NOT NULL THEN
    RETURN v_user;
  END IF;

  INSERT INTO iam.users (email, display_name)
    VALUES (p_email, coalesce(p_display_name, ''))
    RETURNING id INTO v_user;
  INSERT INTO iam.identities (user_id, provider, subject)
    VALUES (v_user, p_provider, p_subject);
  RETURN v_user;
EXCEPTION WHEN unique_violation THEN
  -- Either a concurrent first sign-in for this same identity (return its user) or an email
  -- already owned by a different identity (a conflict the caller must surface).
  SELECT i.user_id INTO v_user
    FROM iam.identities i WHERE i.provider = p_provider AND i.subject = p_subject;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'email already belongs to another identity'
      USING ERRCODE = '23505', HINT = 'identity.email_taken';
  END IF;
  RETURN v_user;
END
$$;

-- Identity -> user, only for active users.
CREATE FUNCTION iam.resolve_identity(p_provider text, p_subject text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id
    FROM iam.identities i JOIN iam.users u ON u.id = i.user_id
   WHERE i.provider = p_provider AND i.subject = p_subject AND u.status = 'active'
$$;

-- Creates an organization with the calling user as its owner. The caller is taken from the
-- transaction context (withUserTransaction), never from an argument, so no one can create an
-- organization on behalf of someone else. The function then acts INSIDE the new tenant's
-- context, so RLS still constrains what it writes, and restores the caller's context after.
CREATE FUNCTION iam.create_organization(p_name text, p_slug text, p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_org uuid;
  v_previous text := coalesce(current_setting('app.org_id', true), '');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'creating an organization requires an authenticated user'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM iam.users WHERE id = v_user AND status = 'active') THEN
    RAISE EXCEPTION 'user is not active' USING ERRCODE = '42501';
  END IF;

  INSERT INTO iam.organizations (name, slug, kind)
    VALUES (p_name, p_slug, p_kind)
    RETURNING id INTO v_org;

  PERFORM set_config('app.org_id', v_org::text, true);
  INSERT INTO iam.memberships (organization_id, user_id) VALUES (v_org, v_user);
  INSERT INTO iam.role_assignments (organization_id, user_id, role_key, granted_by)
    VALUES (v_org, v_user, 'owner', v_user);
  PERFORM set_config('app.org_id', v_previous, true);

  RETURN v_org;
END
$$;

REVOKE ALL ON FUNCTION
  iam.provision_user(text, text, text, text),
  iam.resolve_identity(text, text),
  iam.create_organization(text, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  iam.provision_user(text, text, text, text),
  iam.resolve_identity(text, text),
  iam.create_organization(text, text, text)
TO legalintel_app;
