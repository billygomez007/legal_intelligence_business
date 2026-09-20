-- The role-assignment hierarchy, enforced by the database as well as by the application.
-- Forward migration: IAM 0001 is untouched. Design: docs/adr/0008-integrity-hardening-stages-0-5.md.
--
-- Until now "an admin may not grant owner" was a rule of the TypeScript layer only. The runtime
-- role could INSERT into iam.role_assignments directly, so a service that forgot to ask (or a bug
-- that reached SQL) could promote a viewer to owner. The rules below are the same ones as
-- `ASSIGNABLE` in packages/platform/iam/src/domain/authz.ts, and a parity test fails if the two
-- ever differ:
--
--     owner   may grant / revoke  owner, admin, member, viewer
--     admin   may grant / revoke  member, viewer
--     member  may grant / revoke  nothing
--     viewer  may grant / revoke  nothing
--
-- Who is acting comes from the transaction context (`app.user_id`, set by withTenantTransaction),
-- the same variable row-level security already trusts. No identity column is added or trusted.
-- With no acting user the answer is no. No SECURITY DEFINER function is introduced: everything
-- runs as the caller, whose row-level security already lets it read what it needs.

-- ---------------------------------------------------------------------------------------
-- 1. The matrix. IMMUTABLE and total: an unknown role may grant nothing, and nothing may grant
--    an unknown role, and the answer is a definite false (never NULL).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION iam.role_may_assign(p_actor_role text, p_target_role text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE p_actor_role
           WHEN 'owner' THEN coalesce(p_target_role IN ('owner', 'admin', 'member', 'viewer'), false)
           WHEN 'admin' THEN coalesce(p_target_role IN ('member', 'viewer'), false)
           ELSE false
         END
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Does this user CURRENTLY hold authority to grant p_role in this organization? Authority
--    comes from roles held through an ACTIVE membership by an ACTIVE account, so suspending
--    either takes it away at once. Several roles give the union of what each may grant.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION iam.actor_may_assign(p_org uuid, p_actor uuid, p_role text) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM iam.role_assignments r
      JOIN iam.memberships m ON m.organization_id = r.organization_id AND m.user_id = r.user_id
      JOIN iam.users u ON u.id = r.user_id
     WHERE r.organization_id = p_org
       AND r.user_id = p_actor
       AND m.status = 'active'
       AND u.status = 'active'
       AND iam.role_may_assign(r.role_key, p_role)
  )
$$;

REVOKE ALL ON FUNCTION iam.role_may_assign(text, text), iam.actor_may_assign(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.role_may_assign(text, text), iam.actor_may_assign(uuid, uuid, text)
  TO legalintel_app;

-- ---------------------------------------------------------------------------------------
-- 3. Granting and revoking a role.
--
-- A row for an organization other than the one the session is acting in is left for row-level
-- security to refuse: answering "you may not" there would report a hierarchy problem for what is
-- a tenancy problem. With NO tenant context there is nothing for row-level security to compare
-- (and a superuser is not subject to it), so the hierarchy is applied and, with no acting user,
-- refuses.
--
-- A grant must name the acting user as its grantor, so the record of who granted a role cannot
-- be forged. The one exception to "the actor must hold authority" is the first owner of a
-- brand-new organization, which is what iam.create_organization does: the creator holds no role
-- yet because the organization has no roles at all. That allowance is shaped narrowly (owner, to
-- oneself, granted by oneself, an organization with no role assignment of any kind) so it cannot
-- be used on an organization that already exists.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION iam.enforce_role_hierarchy() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_org   uuid;
  v_role  text;
  v_actor uuid := app.current_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_org := NEW.organization_id;
    v_role := NEW.role_key;
  ELSE
    v_org := OLD.organization_id;
    v_role := OLD.role_key;
  END IF;

  IF app.current_org_id() IS NOT NULL AND v_org IS DISTINCT FROM app.current_org_id() THEN
    RETURN CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NOT NULL AND NEW.granted_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'a role must be granted in the name of the person granting it'
        USING ERRCODE = '42501', HINT = 'authz.role_not_assignable';
    END IF;

    IF NEW.role_key = 'owner'
       AND v_actor IS NOT NULL
       AND NEW.user_id = v_actor
       AND NEW.granted_by = v_actor
       AND EXISTS (SELECT 1 FROM iam.memberships m
                    WHERE m.organization_id = v_org AND m.user_id = v_actor AND m.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM iam.role_assignments r WHERE r.organization_id = v_org) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_actor IS NULL OR NOT iam.actor_may_assign(v_org, v_actor, v_role) THEN
    RAISE EXCEPTION 'the acting user may not grant or revoke that role'
      USING ERRCODE = '42501', HINT = 'authz.role_not_assignable';
  END IF;

  RETURN CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
END
$$;

-- Named to sort before role_assignments_keep_owner (IAM 0001), so the hierarchy is decided first
-- and the last-owner rule still has the final word on what the hierarchy allows.
CREATE TRIGGER role_assignments_hierarchy
  BEFORE INSERT OR DELETE ON iam.role_assignments
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_role_hierarchy();

-- ---------------------------------------------------------------------------------------
-- 4. Suspending or removing a member (or reinstating one) is the same kind of authority: an
--    admin who cannot revoke an owner's role must not be able to remove the owner instead.
--    The actor must hold a role that can grant something (in the shipped catalog exactly the
--    roles that hold member:remove) and be able to grant every role the target holds, which is
--    canManageMember() in TypeScript. One allowance: a person accepting their own invitation.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION iam.enforce_member_management() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor uuid := app.current_user_id();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF app.current_org_id() IS NOT NULL AND OLD.organization_id IS DISTINCT FROM app.current_org_id() THEN
    RETURN NEW;
  END IF;
  IF v_actor IS NOT NULL AND OLD.user_id = v_actor AND OLD.status = 'invited' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF v_actor IS NULL
     OR NOT iam.actor_may_assign(OLD.organization_id, v_actor, 'viewer')
     OR EXISTS (
       SELECT 1 FROM iam.role_assignments r
        WHERE r.organization_id = OLD.organization_id
          AND r.user_id = OLD.user_id
          AND NOT iam.actor_may_assign(OLD.organization_id, v_actor, r.role_key)
     ) THEN
    RAISE EXCEPTION 'the acting user may not change the status of that member'
      USING ERRCODE = '42501', HINT = 'authz.member_not_manageable';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER memberships_hierarchy
  BEFORE UPDATE OF status ON iam.memberships
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_member_management();
