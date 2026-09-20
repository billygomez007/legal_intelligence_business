import {
  withPublicTransaction,
  withTenantTransaction,
  withUserTransaction,
  platformMigrations,
  type DbPool,
} from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { createFixedClock, type OrganizationId, type UserId } from '@legalintel/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ORG_ROLES,
  addMember,
  assignRole,
  canAssignRole,
  canManageMember,
  iamMigrations,
  loadUserContext,
  pgIamStore,
  removeMember,
  revokeRole,
  type AuthzContext,
  type IamDeps,
  type OrgRole,
} from '../src';
import { catalog } from './fixtures';

/**
 * Who may grant, revoke or manage which role is decided twice: in TypeScript (for a clear
 * error) and by the database (so direct SQL, or a service that forgot to ask, cannot bypass it).
 * The database identifies the actor from the transaction context (`app.user_id`), the same
 * variable row-level security already trusts, and applies the same matrix. These tests attack
 * the database directly, as the runtime role, and prove the two matrices are the same.
 */
let database: TestDatabase;
let pool: DbPool;
let deps: IamDeps;
const clock = createFixedClock(new Date());

beforeAll(async () => {
  database = await createTestDatabase({ migrationSets: [platformMigrations, iamMigrations] });
  pool = database.poolFor('app', { max: 12 });
  deps = { pool, store: pgIamStore, catalog, clock };
});

afterAll(async () => {
  await database.dispose();
});

let counter = 0;
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

const newUser = (label = 'user') =>
  withPublicTransaction(pool, (tx) =>
    pgIamStore.provisionUser(tx, {
      provider: 'test-idp',
      subject: unique(`sub-${label}`),
      email: `${unique(label)}@example.test`,
      displayName: label,
    }),
  );

const newOrg = (owner: UserId) =>
  withUserTransaction(pool, owner, (tx) =>
    pgIamStore.createOrganization(tx, { name: 'Org', slug: unique('org'), kind: 'firm' }),
  );

const asTenant = <T>(
  org: OrganizationId,
  user: UserId | undefined,
  fn: Parameters<typeof withTenantTransaction<T>>[2],
) =>
  withTenantTransaction(
    pool,
    user === undefined ? { organizationId: org } : { organizationId: org, userId: user },
    fn,
  );

type AdminClient = Parameters<Parameters<TestDatabase['withAdmin']>[0]>[0];
const admin = <T>(fn: (client: AdminClient) => Promise<T>) => database.withAdmin(fn);

/** Adds `user` to the organization through the supported API, as its owner. */
async function join(org: OrganizationId, owner: UserId, user: UserId, roles: readonly OrgRole[]) {
  const ownerContext = await loadUserContext(deps, owner, org);
  await asTenant(org, owner, async (tx) => {
    await addMember(tx, pgIamStore, ownerContext, user);
    for (const role of roles) await assignRole(tx, pgIamStore, ownerContext, user, role);
  });
}

/** One organization with a member in every position, and a second owner so the last-owner rule stays out of the way. */
async function scenario() {
  const owner = await newUser('owner');
  const org = await newOrg(owner);
  const people = {
    owner,
    otherOwner: await newUser('owner2'),
    admin: await newUser('admin'),
    otherAdmin: await newUser('admin2'),
    member: await newUser('member'),
    viewer: await newUser('viewer'),
    roleless: await newUser('roleless'),
  };
  await join(org, owner, people.otherOwner, ['owner']);
  await join(org, owner, people.admin, ['admin']);
  await join(org, owner, people.otherAdmin, ['admin']);
  await join(org, owner, people.member, ['member']);
  await join(org, owner, people.viewer, ['viewer']);
  await join(org, owner, people.roleless, []);
  return { org, ...people };
}

// ---- direct SQL, exactly as a service that skipped the TypeScript check would issue it ----------
const grantSql = (
  org: OrganizationId,
  actor: UserId | undefined,
  target: UserId,
  role: string,
  grantedBy: UserId | undefined = actor,
) =>
  asTenant(org, actor, (tx) =>
    tx.query(
      `INSERT INTO iam.role_assignments (organization_id, user_id, role_key, granted_by)
       VALUES (app.current_org_id(), $1, $2, $3)`,
      [target, role, grantedBy],
    ),
  );

const revokeSql = (org: OrganizationId, actor: UserId | undefined, target: UserId, role: string) =>
  asTenant(org, actor, (tx) =>
    tx.query(
      `DELETE FROM iam.role_assignments
        WHERE organization_id = app.current_org_id() AND user_id = $1 AND role_key = $2`,
      [target, role],
    ),
  );

const statusSql = (
  org: OrganizationId,
  actor: UserId | undefined,
  target: UserId,
  status: string,
) =>
  asTenant(org, actor, (tx) =>
    tx.query(
      `UPDATE iam.memberships SET status = $2, updated_at = now()
        WHERE organization_id = app.current_org_id() AND user_id = $1`,
      [target, status],
    ),
  );

const rolesOf = async (org: OrganizationId, user: UserId) =>
  (
    await admin((c) =>
      c.query<{ role_key: string }>(
        'SELECT role_key FROM iam.role_assignments WHERE organization_id = $1 AND user_id = $2 ORDER BY role_key',
        [org, user],
      ),
    )
  ).rows.map((row) => row.role_key);

const NOT_ASSIGNABLE = { hint: 'authz.role_not_assignable' };
const NOT_MANAGEABLE = { hint: 'authz.member_not_manageable' };

// =============================================================================================
describe('the matrix is one matrix: TypeScript and SQL agree', () => {
  const contextHolding = (roles: readonly OrgRole[]): AuthzContext => ({
    principal: { kind: 'user', userId: 'parity' as UserId },
    organizationId: 'parity-org' as OrganizationId,
    permissions: new Set(['member:assign_role', 'member:remove']),
    roles,
  });

  const pairs = ORG_ROLES.flatMap((actor) => ORG_ROLES.map((target) => [actor, target] as const));

  it.each(pairs)(
    '%s may assign %s: identical answer in TypeScript and in the database',
    async (actor, target) => {
      const sql = await admin((c) =>
        c.query<{ allowed: boolean }>('SELECT iam.role_may_assign($1, $2) AS allowed', [
          actor,
          target,
        ]),
      );
      expect(sql.rows[0]?.allowed).toBe(canAssignRole(contextHolding([actor]), target));
    },
  );

  it('the database matrix is exactly the documented one', async () => {
    const granted: string[] = [];
    for (const [actor, target] of pairs) {
      const result = await admin((c) =>
        c.query<{ allowed: boolean }>('SELECT iam.role_may_assign($1, $2) AS allowed', [
          actor,
          target,
        ]),
      );
      if (result.rows[0]?.allowed === true) granted.push(`${actor}>${target}`);
    }
    expect(granted.sort()).toEqual(
      [
        'owner>owner',
        'owner>admin',
        'owner>member',
        'owner>viewer',
        'admin>member',
        'admin>viewer',
      ].sort(),
    );
  });

  it('an unknown role may assign nothing and nothing may assign an unknown role', async () => {
    for (const [actor, target] of [
      ['superadmin', 'viewer'],
      ['owner', 'superadmin'],
      ['', 'viewer'],
    ] as const) {
      const result = await admin((c) =>
        c.query<{ allowed: boolean | null }>('SELECT iam.role_may_assign($1, $2) AS allowed', [
          actor,
          target,
        ]),
      );
      // A definite false, never NULL: NULL reads as "not true" to one caller and as "unknown" to another.
      expect(result.rows[0]?.allowed, `${actor} > ${target}`).toBe(false);
    }
  });

  it('holding several roles grants the union, as in TypeScript', async () => {
    const s = await scenario();
    const both = await newUser('both');
    await join(s.org, s.owner, both, ['viewer', 'admin']);
    // admin + viewer: may grant member and viewer, still not admin or owner.
    await grantSql(s.org, both, s.roleless, 'member');
    await expect(grantSql(s.org, both, s.roleless, 'admin')).rejects.toMatchObject(NOT_ASSIGNABLE);
    expect(canAssignRole(contextHolding(['viewer', 'admin']), 'member')).toBe(true);
    expect(canAssignRole(contextHolding(['viewer', 'admin']), 'admin')).toBe(false);
  });

  it.each(ORG_ROLES.flatMap((actor) => ORG_ROLES.map((target) => [actor, target] as const)))(
    '%s managing a member who holds %s: the database refuses exactly what canManageMember refuses',
    async (actorRole, targetRole) => {
      const s = await scenario();
      const actor = await newUser('actor');
      const target = await newUser('target');
      await join(s.org, s.owner, actor, [actorRole]);
      await join(s.org, s.owner, target, [targetRole]);
      const allowedByTypescript = canManageMember(contextHolding([actorRole]), 'member:remove', [
        targetRole,
      ]);
      const outcome = await statusSql(s.org, actor, target, 'suspended').then(
        () => 'allowed',
        (error: unknown) => (error as { hint?: string }).hint,
      );
      expect(outcome).toBe(allowedByTypescript ? 'allowed' : 'authz.member_not_manageable');
    },
  );
});

// =============================================================================================
describe('granting a role, attacked with direct SQL as the runtime role', () => {
  it.each([
    ['owner', 'owner'],
    ['owner', 'admin'],
    ['owner', 'member'],
    ['owner', 'viewer'],
  ] as const)('an owner may grant %s (%s)', async (_actor, role) => {
    const s = await scenario();
    await grantSql(s.org, s.owner, s.roleless, role);
    expect(await rolesOf(s.org, s.roleless)).toEqual([role]);
  });

  it.each(['member', 'viewer'] as const)('an admin may grant %s', async (role) => {
    const s = await scenario();
    await grantSql(s.org, s.admin, s.roleless, role);
    expect(await rolesOf(s.org, s.roleless)).toEqual([role]);
  });

  it.each(['owner', 'admin'] as const)(
    'an admin may NOT grant %s, to someone else or to themselves',
    async (role) => {
      const s = await scenario();
      await expect(grantSql(s.org, s.admin, s.roleless, role)).rejects.toMatchObject(
        NOT_ASSIGNABLE,
      );
      await expect(grantSql(s.org, s.admin, s.otherAdmin, 'owner')).rejects.toMatchObject(
        NOT_ASSIGNABLE,
      );
      await expect(grantSql(s.org, s.admin, s.admin, role)).rejects.toMatchObject(NOT_ASSIGNABLE);
      expect(await rolesOf(s.org, s.roleless)).toEqual([]);
      expect(await rolesOf(s.org, s.admin)).toEqual(['admin']);
    },
  );

  it.each(ORG_ROLES)('a member and a viewer may NOT grant %s', async (role) => {
    const s = await scenario();
    for (const actor of [s.member, s.viewer]) {
      await expect(grantSql(s.org, actor, s.roleless, role)).rejects.toMatchObject(NOT_ASSIGNABLE);
      await expect(grantSql(s.org, actor, actor, role)).rejects.toMatchObject(NOT_ASSIGNABLE);
    }
    expect(await rolesOf(s.org, s.roleless)).toEqual([]);
  });

  it('a member with no role at all may not grant anything either', async () => {
    const s = await scenario();
    await expect(grantSql(s.org, s.roleless, s.roleless, 'owner')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
    await expect(grantSql(s.org, s.roleless, s.viewer, 'viewer')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
  });

  it('a viewer cannot promote themselves to owner (the escalation the review found)', async () => {
    const s = await scenario();
    await expect(grantSql(s.org, s.viewer, s.viewer, 'owner')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
    expect(await rolesOf(s.org, s.viewer)).toEqual(['viewer']);
  });

  it('the grantor recorded must be the acting user: an admin cannot borrow an owner’s name', async () => {
    const s = await scenario();
    await expect(grantSql(s.org, s.admin, s.roleless, 'member', s.owner)).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
    await expect(grantSql(s.org, s.viewer, s.roleless, 'viewer', s.owner)).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
    expect(await rolesOf(s.org, s.roleless)).toEqual([]);
  });

  it('with no acting user in the context nothing can be granted', async () => {
    const s = await scenario();
    await expect(grantSql(s.org, undefined, s.roleless, 'viewer', s.owner)).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
  });

  it('an acting user who holds a role only in ANOTHER organization has no authority here', async () => {
    const s = await scenario();
    const elsewhere = await newUser('elsewhere');
    await newOrg(elsewhere); // owner of a different organization
    await expect(grantSql(s.org, elsewhere, s.roleless, 'viewer')).rejects.toSatisfy(
      (error: { hint?: string; code?: string }) =>
        error.hint === 'authz.role_not_assignable' || error.code === '23503',
    );
    expect(await rolesOf(s.org, s.roleless)).toEqual([]);
  });

  it('an acting user whose MEMBERSHIP is suspended has lost their authority', async () => {
    const s = await scenario();
    const ownerContext = await loadUserContext(deps, s.owner, s.org);
    await asTenant(s.org, s.owner, (tx) => removeMember(tx, pgIamStore, ownerContext, s.admin));
    await expect(grantSql(s.org, s.admin, s.roleless, 'viewer')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
  });

  it('an acting user whose ACCOUNT is suspended has lost their authority', async () => {
    const s = await scenario();
    await admin((c) =>
      c.query(`UPDATE iam.users SET status = 'suspended' WHERE id = $1`, [s.admin]),
    );
    await expect(grantSql(s.org, s.admin, s.roleless, 'viewer')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
  });

  it('fails closed even for a superuser who has not stated who is acting', async () => {
    const s = await scenario();
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO iam.role_assignments (organization_id, user_id, role_key, granted_by)
           VALUES ($1, $2, 'owner', $3)`,
          [s.org, s.roleless, s.owner],
        ),
      ),
    ).rejects.toMatchObject(NOT_ASSIGNABLE);
  });

  it('a role that does not exist is refused by the schema, not granted', async () => {
    const s = await scenario();
    await expect(grantSql(s.org, s.owner, s.roleless, 'superadmin')).rejects.toBeDefined();
  });

  it('creating an organization still makes its creator the first owner', async () => {
    const founder = await newUser('founder');
    const org = await newOrg(founder);
    expect(await rolesOf(org, founder)).toEqual(['owner']);
  });

  it('the first-owner allowance cannot be used on an organization that already has roles', async () => {
    const s = await scenario();
    // A member trying the same shape as the bootstrap insert: self, owner, self-granted.
    await expect(grantSql(s.org, s.roleless, s.roleless, 'owner')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
  });
});

// =============================================================================================
describe('revoking a role, attacked with direct SQL as the runtime role', () => {
  it.each(['owner', 'admin', 'member', 'viewer'] as const)(
    'an owner may revoke %s',
    async (role) => {
      const s = await scenario();
      await grantSql(s.org, s.owner, s.roleless, role);
      await revokeSql(s.org, s.owner, s.roleless, role);
      expect(await rolesOf(s.org, s.roleless)).toEqual([]);
    },
  );

  it('an admin may revoke member and viewer roles', async () => {
    const s = await scenario();
    await revokeSql(s.org, s.admin, s.member, 'member');
    await revokeSql(s.org, s.admin, s.viewer, 'viewer');
    expect(await rolesOf(s.org, s.member)).toEqual([]);
    expect(await rolesOf(s.org, s.viewer)).toEqual([]);
  });

  it('an admin may NOT revoke an owner’s or another admin’s role', async () => {
    const s = await scenario();
    await expect(revokeSql(s.org, s.admin, s.otherOwner, 'owner')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
    await expect(revokeSql(s.org, s.admin, s.otherAdmin, 'admin')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
    await expect(revokeSql(s.org, s.admin, s.admin, 'admin')).rejects.toMatchObject(NOT_ASSIGNABLE);
    expect(await rolesOf(s.org, s.otherOwner)).toEqual(['owner']);
    expect(await rolesOf(s.org, s.otherAdmin)).toEqual(['admin']);
  });

  it('a member or a viewer may not revoke anyone’s role, including their own', async () => {
    const s = await scenario();
    for (const actor of [s.member, s.viewer]) {
      await expect(revokeSql(s.org, actor, s.otherOwner, 'owner')).rejects.toMatchObject(
        NOT_ASSIGNABLE,
      );
      await expect(revokeSql(s.org, actor, s.otherAdmin, 'admin')).rejects.toMatchObject(
        NOT_ASSIGNABLE,
      );
      await expect(
        revokeSql(s.org, actor, actor, actor === s.member ? 'member' : 'viewer'),
      ).rejects.toMatchObject(NOT_ASSIGNABLE);
    }
  });

  it('with no acting user in the context nothing can be revoked', async () => {
    const s = await scenario();
    await expect(revokeSql(s.org, undefined, s.otherOwner, 'owner')).rejects.toMatchObject(
      NOT_ASSIGNABLE,
    );
  });

  it('the last-owner protection still holds, after the hierarchy says yes', async () => {
    const owner = await newUser('sole');
    const org = await newOrg(owner);
    await expect(revokeSql(org, owner, owner, 'owner')).rejects.toMatchObject({
      hint: 'org.last_owner',
    });
    expect(await rolesOf(org, owner)).toEqual(['owner']);
  });

  it('an owner may hand over ownership and step down, once another owner exists', async () => {
    const s = await scenario();
    await revokeSql(s.org, s.otherOwner, s.otherOwner, 'owner');
    expect(await rolesOf(s.org, s.otherOwner)).toEqual([]);
  });
});

// =============================================================================================
describe('suspending or removing a member, attacked with direct SQL as the runtime role', () => {
  it.each(['owner', 'admin', 'member', 'viewer'] as const)(
    'an owner may suspend a %s',
    async (role) => {
      const s = await scenario();
      await statusSql(s.org, s.owner, s[role === 'owner' ? 'otherOwner' : role], 'suspended');
    },
  );

  it('an admin may suspend or remove a member, a viewer or a member with no role', async () => {
    const s = await scenario();
    await statusSql(s.org, s.admin, s.member, 'suspended');
    await statusSql(s.org, s.admin, s.viewer, 'removed');
    await statusSql(s.org, s.admin, s.roleless, 'suspended');
  });

  it('an admin may NOT suspend or remove an owner or another admin', async () => {
    const s = await scenario();
    for (const status of ['suspended', 'removed'] as const) {
      await expect(statusSql(s.org, s.admin, s.otherOwner, status)).rejects.toMatchObject(
        NOT_MANAGEABLE,
      );
      await expect(statusSql(s.org, s.admin, s.otherAdmin, status)).rejects.toMatchObject(
        NOT_MANAGEABLE,
      );
      await expect(statusSql(s.org, s.admin, s.admin, status)).rejects.toMatchObject(
        NOT_MANAGEABLE,
      );
    }
  });

  it('a member or a viewer may not change anyone’s status', async () => {
    const s = await scenario();
    for (const actor of [s.member, s.viewer]) {
      for (const target of [s.roleless, s.viewer, s.member, s.otherAdmin, s.otherOwner]) {
        await expect(statusSql(s.org, actor, target, 'suspended')).rejects.toMatchObject(
          NOT_MANAGEABLE,
        );
      }
    }
  });

  it('with no acting user in the context nothing can be changed', async () => {
    const s = await scenario();
    await expect(statusSql(s.org, undefined, s.roleless, 'suspended')).rejects.toMatchObject(
      NOT_MANAGEABLE,
    );
  });

  it('an invited person may still accept their own invitation', async () => {
    const s = await scenario();
    const invitee = await newUser('invitee');
    await asTenant(s.org, s.owner, (tx) => pgIamStore.addMember(tx, invitee, 'invited'));
    await statusSql(s.org, invitee, invitee, 'active');
    // ... but cannot use that allowance to reinstate someone else, or themselves after removal.
    await statusSql(s.org, s.owner, invitee, 'removed');
    await expect(statusSql(s.org, invitee, invitee, 'active')).rejects.toMatchObject(
      NOT_MANAGEABLE,
    );
  });

  it('the last-owner protection still holds for an owner suspending themselves', async () => {
    const owner = await newUser('sole2');
    const org = await newOrg(owner);
    await expect(statusSql(org, owner, owner, 'suspended')).rejects.toMatchObject({
      hint: 'org.last_owner',
    });
  });

  it('a change that alters nothing about the status is not a management action', async () => {
    const s = await scenario();
    // Touching updated_at without changing status must not need authority (no privilege gained).
    await asTenant(s.org, s.viewer, (tx) =>
      tx.query(
        `UPDATE iam.memberships SET updated_at = now() WHERE organization_id = app.current_org_id() AND user_id = $1`,
        [s.viewer],
      ),
    );
  });
});

// =============================================================================================
describe('the application layer reports the database’s refusal with the same typed error', () => {
  it('assignRole reaching the database without the TypeScript check gets authz.role_not_assignable', async () => {
    const s = await scenario();
    await expect(
      asTenant(s.org, s.admin, (tx) => pgIamStore.assignRole(tx, s.roleless, 'owner', s.admin)),
    ).rejects.toMatchObject({ code: 'authz.role_not_assignable' });
  });

  it('revokeRole reaching the database without the TypeScript check gets the same error', async () => {
    const s = await scenario();
    await expect(
      asTenant(s.org, s.admin, (tx) => pgIamStore.revokeRole(tx, s.otherOwner, 'owner')),
    ).rejects.toMatchObject({ code: 'authz.role_not_assignable' });
  });

  it('setMemberStatus reaching the database without the TypeScript check gets authz.denied', async () => {
    const s = await scenario();
    await expect(
      asTenant(s.org, s.admin, (tx) => pgIamStore.setMemberStatus(tx, s.otherOwner, 'removed')),
    ).rejects.toMatchObject({ code: 'authz.denied' });
  });

  it('the database message is never what a caller sees', async () => {
    const s = await scenario();
    try {
      await asTenant(s.org, s.admin, (tx) =>
        pgIamStore.assignRole(tx, s.roleless, 'owner', s.admin),
      );
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/iam\.|role_assignments|trigger|violat/i);
    }
  });

  it('the supported API still works end to end for every allowed grant', async () => {
    const s = await scenario();
    const adminContext = await loadUserContext(deps, s.admin, s.org);
    const ownerContext = await loadUserContext(deps, s.owner, s.org);
    await asTenant(s.org, s.admin, (tx) =>
      assignRole(tx, pgIamStore, adminContext, s.roleless, 'member'),
    );
    await asTenant(s.org, s.owner, (tx) =>
      assignRole(tx, pgIamStore, ownerContext, s.roleless, 'admin'),
    );
    await asTenant(s.org, s.owner, (tx) =>
      revokeRole(tx, pgIamStore, ownerContext, s.roleless, 'admin'),
    );
    expect(await rolesOf(s.org, s.roleless)).toEqual(['member']);
  });
});
