import {
  withPublicTransaction,
  withTenantTransaction,
  withUserTransaction,
  platformMigrations,
  type DbPool,
} from '@legalintel/db';
import {
  checkGuardrails,
  createTestDatabase,
  formatViolations,
  type TestDatabase,
} from '@legalintel/db/testing';
import { OrganizationId, type UserId, createFixedClock, type ApiKeyId } from '@legalintel/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  assignRole,
  authenticateApiKey,
  iamMigrations,
  issueApiKey,
  loadUserContext,
  pgIamStore,
  removeMember,
  revokeApiKey,
  revokeRole,
  type IamDeps,
} from '../src';
import { catalog } from './fixtures';

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

const newOrg = (owner: UserId, kind: 'firm' | 'individual' = 'firm') =>
  withUserTransaction(pool, owner, (tx) =>
    pgIamStore.createOrganization(tx, { name: 'Org', slug: unique('org'), kind }),
  );

const asTenant = <T>(
  org: OrganizationId,
  user: UserId,
  fn: Parameters<typeof withTenantTransaction<T>>[2],
) => withTenantTransaction(pool, { organizationId: org, userId: user }, fn);

/** A member of `org` holding `role`, added by its owner. */
async function memberOf(org: OrganizationId, owner: UserId, role: 'admin' | 'member' | 'viewer') {
  const user = await newUser(role);
  const ownerContext = await loadUserContext(deps, owner, org);
  await asTenant(org, owner, async (tx) => {
    await addMember(tx, pgIamStore, ownerContext, user);
    await assignRole(tx, pgIamStore, ownerContext, user, role);
  });
  return user;
}

const rejectsWith = async (promise: Promise<unknown>, expected: Record<string, unknown>) => {
  await expect(promise).rejects.toMatchObject(expected);
};

type AdminClient = Parameters<Parameters<TestDatabase['withAdmin']>[0]>[0];
const admin = <T>(fn: (client: AdminClient) => Promise<T>) => database.withAdmin(fn);

describe('user provisioning', () => {
  it('creates a user once per identity, however many times they sign in', async () => {
    const input = {
      provider: 'test-idp',
      subject: unique('repeat'),
      email: `${unique('repeat')}@example.test`,
      displayName: 'Repeat',
    };
    const first = await withPublicTransaction(pool, (tx) => pgIamStore.provisionUser(tx, input));
    const second = await withPublicTransaction(pool, (tx) => pgIamStore.provisionUser(tx, input));
    expect(second).toBe(first);
  });

  it('returns the same user for concurrent first sign-ins of one identity', async () => {
    const input = {
      provider: 'test-idp',
      subject: unique('race'),
      email: `${unique('race')}@example.test`,
      displayName: 'Race',
    };
    const ids = await Promise.all(
      Array.from({ length: 6 }, () =>
        withPublicTransaction(pool, (tx) => pgIamStore.provisionUser(tx, input)),
      ),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('does NOT link a new identity to an existing account by email (account-takeover guard)', async () => {
    const email = `${unique('victim')}@example.test`;
    await withPublicTransaction(pool, (tx) =>
      pgIamStore.provisionUser(tx, {
        provider: 'idp-a',
        subject: unique('a'),
        email,
        displayName: 'Victim',
      }),
    );
    await rejectsWith(
      withPublicTransaction(pool, (tx) =>
        pgIamStore.provisionUser(tx, {
          provider: 'idp-b',
          subject: unique('b'),
          email,
          displayName: 'Attacker',
        }),
      ),
      { kind: 'conflict', code: 'identity.email_taken' },
    );
  });

  it('treats email case-insensitively', async () => {
    const local = unique('case');
    await withPublicTransaction(pool, (tx) =>
      pgIamStore.provisionUser(tx, {
        provider: 'p',
        subject: unique('s'),
        email: `${local}@Example.Test`,
        displayName: '',
      }),
    );
    await rejectsWith(
      withPublicTransaction(pool, (tx) =>
        pgIamStore.provisionUser(tx, {
          provider: 'p2',
          subject: unique('s'),
          email: `${local}@example.test`,
          displayName: '',
        }),
      ),
      { code: 'identity.email_taken' },
    );
  });

  it('resolves identities to active users only', async () => {
    const subject = unique('resolve');
    const userId = await withPublicTransaction(pool, (tx) =>
      pgIamStore.provisionUser(tx, {
        provider: 'p',
        subject,
        email: `${unique('r')}@example.test`,
        displayName: '',
      }),
    );
    const resolve = () =>
      withPublicTransaction(pool, (tx) => pgIamStore.resolveIdentity(tx, 'p', subject));

    expect(await resolve()).toBe(userId);
    expect(
      await withPublicTransaction(pool, (tx) => pgIamStore.resolveIdentity(tx, 'p', 'nobody')),
    ).toBeNull();

    await admin((c) =>
      c.query(`UPDATE iam.users SET status = 'suspended' WHERE id = $1`, [userId]),
    );
    expect(await resolve()).toBeNull();
  });

  it('gives the application role no direct write access to users or any access to identities', async () => {
    await expect(
      pool.query(`INSERT INTO iam.users (email) VALUES ('sneaky@example.test')`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query('SELECT * FROM iam.identities')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('organizations', () => {
  it('makes the creator an active member and owner, visible only to members', async () => {
    const owner = await newUser('owner');
    const stranger = await newUser('stranger');
    const org = await newOrg(owner);

    const mine = await withUserTransaction(pool, owner, (tx) => pgIamStore.listMyOrganizations(tx));
    expect(mine.map((o) => o.id)).toContain(org);

    const theirs = await withUserTransaction(pool, stranger, (tx) =>
      pgIamStore.listMyOrganizations(tx),
    );
    expect(theirs.map((o) => o.id)).not.toContain(org);

    const context = await loadUserContext(deps, owner, org);
    expect(context.roles).toEqual(['owner']);
    expect(context.permissions.has('billing:manage')).toBe(true);
  });

  it('lists every organization a user belongs to, and only theirs (the workspace switcher)', async () => {
    const user = await newUser('multi');
    const other = await newUser('other');
    const a = await newOrg(user);
    const b = await newOrg(user);
    const c = await newOrg(other);

    const listed = (
      await withUserTransaction(pool, user, (tx) => pgIamStore.listMyOrganizations(tx))
    ).map((o) => o.id);
    expect(listed).toEqual(expect.arrayContaining([a, b]));
    expect(listed).not.toContain(c);
  });

  it('requires a signed-in user, taken from the transaction and never from an argument', async () => {
    await rejectsWith(
      withPublicTransaction(pool, (tx) =>
        pgIamStore.createOrganization(tx, { name: 'Anon', slug: unique('anon'), kind: 'firm' }),
      ),
      { kind: 'forbidden' },
    );
  });

  it('refuses a suspended user', async () => {
    const user = await newUser('suspended');
    await admin((c) => c.query(`UPDATE iam.users SET status = 'suspended' WHERE id = $1`, [user]));
    await rejectsWith(newOrg(user), { kind: 'forbidden' });
  });

  it('enforces unique slugs and valid slugs with typed errors, not driver messages', async () => {
    const owner = await newUser('slugger');
    const slug = unique('taken');
    await withUserTransaction(pool, owner, (tx) =>
      pgIamStore.createOrganization(tx, { name: 'First', slug, kind: 'firm' }),
    );
    await rejectsWith(
      withUserTransaction(pool, owner, (tx) =>
        pgIamStore.createOrganization(tx, { name: 'Second', slug, kind: 'firm' }),
      ),
      { kind: 'conflict', code: 'organization.slug_taken' },
    );
    for (const bad of [
      'UPPER CASE',
      'UPPERCASE',
      'a',
      '-leading',
      'has_underscore',
      'x'.repeat(64),
    ]) {
      await rejectsWith(
        withUserTransaction(pool, owner, (tx) =>
          pgIamStore.createOrganization(tx, { name: 'Bad', slug: bad, kind: 'firm' }),
        ),
        { kind: 'validation', code: 'input.invalid' },
      );
    }
  });

  it('restores the caller’s context after creating an organization', async () => {
    const owner = await newUser('ctx');
    const after = await withUserTransaction(pool, owner, async (tx) => {
      await pgIamStore.createOrganization(tx, { name: 'Ctx', slug: unique('ctx'), kind: 'firm' });
      const result = await tx.query<{ org: string | null; user: string | null }>(
        'SELECT app.current_org_id() AS org, app.current_user_id() AS "user"',
      );
      return result.rows[0];
    });
    expect(after).toEqual({ org: null, user: owner });
  });

  it('lets the application rename an organization but not change its slug, kind or status', async () => {
    const owner = await newUser('rename');
    const org = await newOrg(owner);
    await asTenant(org, owner, (tx) =>
      tx.query(`UPDATE iam.organizations SET name = 'Renamed', updated_at = now() WHERE id = $1`, [
        org,
      ]),
    );
    for (const column of ['slug', 'kind', 'status']) {
      const value = column === 'slug' ? "'hijack'" : column === 'kind' ? "'corporate'" : "'closed'";
      await rejectsWith(
        asTenant(org, owner, (tx) =>
          tx.query(`UPDATE iam.organizations SET ${column} = ${value} WHERE id = $1`, [org]),
        ),
        { code: '42501' },
      );
    }
  });
});

describe('tenant isolation on the real tables', () => {
  it('shows an organization only its own memberships, roles and keys', async () => {
    const ownerA = await newUser('isoA');
    const ownerB = await newUser('isoB');
    const orgA = await newOrg(ownerA);
    const orgB = await newOrg(ownerB);
    await memberOf(orgA, ownerA, 'member');

    const seenByB = await asTenant(orgB, ownerB, async (tx) => ({
      members: (
        await tx.query<{ organization_id: string }>('SELECT organization_id FROM iam.memberships')
      ).rows,
      roles: (
        await tx.query<{ organization_id: string }>(
          'SELECT organization_id FROM iam.role_assignments',
        )
      ).rows,
    }));
    expect(new Set(seenByB.members.map((r) => r.organization_id))).toEqual(new Set([orgB]));
    expect(new Set(seenByB.roles.map((r) => r.organization_id))).toEqual(new Set([orgB]));
  });

  it('lets a user see their own memberships everywhere, but no one else’s outside the current organization', async () => {
    const shared = await newUser('shared');
    const ownerA = await newUser('scopeA');
    const orgA = await newOrg(ownerA);
    const orgB = await newOrg(shared);
    const ctxA = await loadUserContext(deps, ownerA, orgA);
    await asTenant(orgA, ownerA, (tx) => addMember(tx, pgIamStore, ctxA, shared));

    // Signed in but with no organization selected: exactly their own two memberships.
    const own = await withUserTransaction(pool, shared, (tx) =>
      tx.query<{ organization_id: string; user_id: string }>(
        'SELECT organization_id, user_id FROM iam.memberships',
      ),
    );
    expect(new Set(own.rows.map((r) => r.user_id))).toEqual(new Set([shared]));
    expect(new Set(own.rows.map((r) => r.organization_id))).toEqual(new Set([orgA, orgB]));

    // Inside org B, `shared` must not see org A's other member (ownerA) through org B.
    const insideB = await asTenant(orgB, shared, (tx) =>
      tx.query<{ user_id: string }>('SELECT user_id FROM iam.memberships'),
    );
    const visible = new Set(insideB.rows.map((r) => r.user_id));
    expect(visible.has(ownerA)).toBe(false);
  });

  it('makes cross-tenant role assignment impossible (composite foreign key)', async () => {
    const ownerA = await newUser('xtA');
    const ownerB = await newUser('xtB');
    const orgA = await newOrg(ownerA);
    await newOrg(ownerB);

    const ctxA = await loadUserContext(deps, ownerA, orgA);
    // ownerB is not a member of org A, so nothing can be assigned to them there.
    await rejectsWith(
      asTenant(orgA, ownerA, (tx) => assignRole(tx, pgIamStore, ctxA, ownerB, 'member')),
      { kind: 'forbidden' },
    );
    // Bypassing the application check and going straight at the table hits the foreign key.
    await rejectsWith(
      asTenant(orgA, ownerA, (tx) => pgIamStore.assignRole(tx, ownerB, 'member', ownerA)),
      { kind: 'not_found', code: 'member.not_found' },
    );
  });

  it('refuses to write a membership row for a different organization', async () => {
    const ownerA = await newUser('wA');
    const ownerB = await newUser('wB');
    const orgA = await newOrg(ownerA);
    const orgB = await newOrg(ownerB);
    const intruder = await newUser('intruder');

    await expect(
      asTenant(orgA, ownerA, (tx) =>
        tx.query(`INSERT INTO iam.memberships (organization_id, user_id) VALUES ($1, $2)`, [
          orgB,
          intruder,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot see or edit another organization even by naming its id', async () => {
    const ownerA = await newUser('nA');
    const ownerB = await newUser('nB');
    const orgA = await newOrg(ownerA);
    const orgB = await newOrg(ownerB);

    const seen = await asTenant(orgA, ownerA, (tx) =>
      tx.query('SELECT * FROM iam.organizations WHERE id = $1', [orgB]),
    );
    expect(seen.rows).toHaveLength(0);
    const updated = await asTenant(orgA, ownerA, (tx) =>
      tx.query(`UPDATE iam.organizations SET name = 'pwned' WHERE id = $1`, [orgB]),
    );
    expect(updated.rowCount).toBe(0);
  });

  it('shows colleagues to each other and strangers to no one', async () => {
    const owner = await newUser('vis-owner');
    const colleague = await newUser('vis-colleague');
    const stranger = await newUser('vis-stranger');
    const org = await newOrg(owner);
    const ctx = await loadUserContext(deps, owner, org);
    await asTenant(org, owner, (tx) => addMember(tx, pgIamStore, ctx, colleague));
    await newOrg(stranger);

    const visible = await asTenant(org, owner, (tx) =>
      tx.query<{ id: string }>('SELECT id FROM iam.users'),
    );
    const ids = visible.rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([owner, colleague]));
    expect(ids).not.toContain(stranger);
  });

  it('does not allow deleting memberships (removal is a status change, preserving history)', async () => {
    const owner = await newUser('nodel');
    const org = await newOrg(owner);
    await rejectsWith(
      asTenant(org, owner, (tx) =>
        tx.query('DELETE FROM iam.memberships WHERE organization_id = $1', [org]),
      ),
      { code: '42501' },
    );
  });

  it('keeps the ingestion and data-ops roles out of identity data entirely', async () => {
    for (const role of ['ingest', 'dataops'] as const) {
      const rolePool = database.poolFor(role);
      await expect(rolePool.query('SELECT * FROM iam.users')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(rolePool.query('SELECT * FROM iam.memberships')).rejects.toMatchObject({
        code: '42501',
      });
    }
  });

  it('passes every structural guardrail on the real schema', async () => {
    const found = await database.withAdmin((client) =>
      checkGuardrails(client, {
        // memberships intentionally lets a user list their OWN memberships across
        // organizations; its bespoke policies are verified by the tests above.
        tenantTableExemptions: ['iam.memberships'],
      }),
    );
    expect(found, formatViolations(found)).toEqual([]);
  });
});

describe('the last owner', () => {
  it('cannot be removed or demoted', async () => {
    const owner = await newUser('sole');
    const org = await newOrg(owner);
    const ctx = await loadUserContext(deps, owner, org);

    await rejectsWith(
      asTenant(org, owner, (tx) => removeMember(tx, pgIamStore, ctx, owner)),
      {
        kind: 'precondition_failed',
        code: 'org.last_owner',
      },
    );
    await rejectsWith(
      asTenant(org, owner, (tx) => revokeRole(tx, pgIamStore, ctx, owner, 'owner')),
      {
        code: 'org.last_owner',
      },
    );
  });

  it('can be replaced once another owner exists', async () => {
    const first = await newUser('first');
    const second = await newUser('second');
    const org = await newOrg(first);
    const ctx = await loadUserContext(deps, first, org);
    await asTenant(org, first, async (tx) => {
      await addMember(tx, pgIamStore, ctx, second);
      await assignRole(tx, pgIamStore, ctx, second, 'owner');
    });

    await asTenant(org, first, (tx) => revokeRole(tx, pgIamStore, ctx, first, 'owner'));
    const after = await loadUserContext(deps, second, org);
    expect(after.roles).toContain('owner');
  });

  it('holds under concurrency: two owners removing each other cannot leave zero owners', async () => {
    const a = await newUser('coA');
    const b = await newUser('coB');
    const org = await newOrg(a);
    const ctxA = await loadUserContext(deps, a, org);
    await asTenant(org, a, async (tx) => {
      await addMember(tx, pgIamStore, ctxA, b);
      await assignRole(tx, pgIamStore, ctxA, b, 'owner');
    });
    const ctxB = await loadUserContext(deps, b, org);

    // Each owner revokes the OTHER owner's role, at the same moment.
    const outcomes = await Promise.allSettled([
      asTenant(org, a, async (tx) => {
        await tx.query('SELECT pg_sleep(0.2)');
        await revokeRole(tx, pgIamStore, ctxA, b, 'owner');
      }),
      asTenant(org, b, async (tx) => {
        await tx.query('SELECT pg_sleep(0.2)');
        await revokeRole(tx, pgIamStore, ctxB, a, 'owner');
      }),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const failure = outcomes.find((o) => o.status === 'rejected');
    expect(failure).toMatchObject({ reason: { code: 'org.last_owner' } });

    const owners = await admin((c) =>
      c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM iam.role_assignments WHERE organization_id = $1 AND role_key = 'owner'`,
        [org],
      ),
    );
    expect(owners.rows[0]?.n).toBe('1');
  });
});

describe('who can do what (application rules over the real database)', () => {
  it('resolves a member’s permissions from the database, and refuses non-members as "not found"', async () => {
    const owner = await newUser('ctx-owner');
    const org = await newOrg(owner);
    const viewer = await memberOf(org, owner, 'viewer');
    const outsider = await newUser('ctx-outsider');

    const context = await loadUserContext(deps, viewer, org);
    expect(context.roles).toEqual(['viewer']);
    expect(context.permissions.has('member:invite')).toBe(false);
    expect(context.permissions.has('project:read:own')).toBe(true);

    await rejectsWith(loadUserContext(deps, outsider, org), { kind: 'not_found' });
  });

  it('treats a removed or suspended member as a non-member', async () => {
    const owner = await newUser('rm-owner');
    const org = await newOrg(owner);
    const member = await memberOf(org, owner, 'member');
    const ctx = await loadUserContext(deps, owner, org);

    await asTenant(org, owner, (tx) => removeMember(tx, pgIamStore, ctx, member));
    await rejectsWith(loadUserContext(deps, member, org), { kind: 'not_found' });
  });

  it('refuses a suspended organization', async () => {
    const owner = await newUser('susp-owner');
    const org = await newOrg(owner);
    await admin((c) =>
      c.query(`UPDATE iam.organizations SET status = 'suspended' WHERE id = $1`, [org]),
    );
    await rejectsWith(loadUserContext(deps, owner, org), { code: 'organization.inactive' });
  });

  it('only lets those with member:invite add members', async () => {
    const owner = await newUser('inv-owner');
    const org = await newOrg(owner);
    const viewer = await memberOf(org, owner, 'viewer');
    const newcomer = await newUser('newcomer');
    const viewerCtx = await loadUserContext(deps, viewer, org);

    await rejectsWith(
      asTenant(org, viewer, (tx) => addMember(tx, pgIamStore, viewerCtx, newcomer)),
      {
        kind: 'forbidden',
        code: 'authz.denied',
      },
    );
  });

  it('stops an admin granting owner or admin, but lets an owner do both', async () => {
    const owner = await newUser('as-owner');
    const org = await newOrg(owner);
    const adminUser = await memberOf(org, owner, 'admin');
    const member = await memberOf(org, owner, 'member');
    const adminCtx = await loadUserContext(deps, adminUser, org);
    const ownerCtx = await loadUserContext(deps, owner, org);

    await rejectsWith(
      asTenant(org, adminUser, (tx) => assignRole(tx, pgIamStore, adminCtx, member, 'owner')),
      {
        code: 'authz.role_not_assignable',
      },
    );
    await rejectsWith(
      asTenant(org, adminUser, (tx) => assignRole(tx, pgIamStore, adminCtx, member, 'admin')),
      {
        code: 'authz.role_not_assignable',
      },
    );
    await asTenant(org, adminUser, (tx) => assignRole(tx, pgIamStore, adminCtx, member, 'viewer'));
    await asTenant(org, owner, (tx) => assignRole(tx, pgIamStore, ownerCtx, member, 'admin'));

    const promoted = await loadUserContext(deps, member, org);
    expect([...promoted.roles].sort()).toEqual(['admin', 'member', 'viewer']);
  });

  it('stops an admin removing an owner, but lets an owner remove an admin', async () => {
    const owner = await newUser('rmo-owner');
    const org = await newOrg(owner);
    const adminUser = await memberOf(org, owner, 'admin');
    const adminCtx = await loadUserContext(deps, adminUser, org);
    const ownerCtx = await loadUserContext(deps, owner, org);

    await rejectsWith(
      asTenant(org, adminUser, (tx) => removeMember(tx, pgIamStore, adminCtx, owner)),
      {
        kind: 'forbidden',
      },
    );
    await asTenant(org, owner, (tx) => removeMember(tx, pgIamStore, ownerCtx, adminUser));
    await rejectsWith(loadUserContext(deps, adminUser, org), { kind: 'not_found' });
  });
});

describe('API keys', () => {
  async function scenario() {
    const owner = await newUser('key-owner');
    const org = await newOrg(owner);
    const ownerCtx = await loadUserContext(deps, owner, org);
    const issue = (
      scopes = ['corpus:read', 'project:read:any'],
      extra: { expiresAt?: Date } = {},
    ) =>
      asTenant(org, owner, (tx) =>
        issueApiKey(tx, pgIamStore, catalog, ownerCtx, { name: 'ci', scopes, ...extra }, clock),
      );
    return { owner, org, ownerCtx, issue };
  }

  const invalidKeyError = {
    kind: 'unauthenticated',
    code: 'auth.invalid_api_key',
    message: 'Invalid API key.',
  };

  it('authenticates a fresh key with exactly the scopes granted', async () => {
    const { org, issue } = await scenario();
    const { plaintext } = await issue();

    const context = await authenticateApiKey(deps, plaintext);
    expect(context.organizationId).toBe(org);
    expect(context.principal.kind).toBe('api_key');
    expect([...context.permissions].sort()).toEqual(['corpus:read', 'project:read:any']);
  });

  it('gives the identical error for every kind of failure, so failures reveal nothing', async () => {
    const { org, owner, ownerCtx, issue } = await scenario();
    const { plaintext, record } = await issue();
    const parts = plaintext.split('_'); // lip1, org, keyId, secret

    const wrongSecret = `${parts.slice(0, 3).join('_')}_${'A'.repeat(43)}`;
    const unknownKeyId = `lip1_${parts[1]}_${'1'.repeat(32)}_${parts[3]}`;
    const otherOrg = OrganizationId.generate().replaceAll('-', '');
    const tamperedOrg = `lip1_${otherOrg}_${parts[2]}_${parts[3]}`;
    const attempts: Record<string, string> = {
      malformed: 'not-a-key',
      wrongSecret,
      unknownKeyId,
      tamperedOrg,
    };

    for (const [label, key] of Object.entries(attempts)) {
      await expect(authenticateApiKey(deps, key), label).rejects.toMatchObject(invalidKeyError);
    }

    // Revoked.
    await asTenant(org, owner, (tx) => revokeApiKey(tx, pgIamStore, ownerCtx, record.id));
    await expect(authenticateApiKey(deps, plaintext), 'revoked').rejects.toMatchObject(
      invalidKeyError,
    );
  });

  it('rejects an expired key', async () => {
    const { issue } = await scenario();
    const { plaintext } = await issue(['corpus:read'], {
      expiresAt: new Date(clock.now().getTime() + 60_000),
    });
    await authenticateApiKey(deps, plaintext);

    clock.advance(120_000);
    await expect(authenticateApiKey(deps, plaintext)).rejects.toMatchObject(invalidKeyError);
  });

  it('stops working when its organization is suspended or its issuer removed', async () => {
    const one = await scenario();
    const keyOne = await one.issue();
    await admin((c) =>
      c.query(`UPDATE iam.organizations SET status = 'suspended' WHERE id = $1`, [one.org]),
    );
    await expect(authenticateApiKey(deps, keyOne.plaintext)).rejects.toMatchObject(invalidKeyError);

    // Issuer removed: a second, healthy organization whose issuer is an admin, later removed.
    const owner = await newUser('rk-owner');
    const org = await newOrg(owner);
    const adminUser = await memberOf(org, owner, 'admin');
    const adminCtx = await loadUserContext(deps, adminUser, org);
    const issued = await asTenant(org, adminUser, (tx) =>
      issueApiKey(tx, pgIamStore, catalog, adminCtx, { name: 'k', scopes: ['corpus:read'] }, clock),
    );
    await authenticateApiKey(deps, issued.plaintext);

    const ownerCtx = await loadUserContext(deps, owner, org);
    await asTenant(org, owner, (tx) => removeMember(tx, pgIamStore, ownerCtx, adminUser));
    await expect(authenticateApiKey(deps, issued.plaintext)).rejects.toMatchObject(invalidKeyError);
  });

  it('is narrowed immediately when its issuer is demoted', async () => {
    const owner = await newUser('dem-owner');
    const org = await newOrg(owner);
    const adminUser = await memberOf(org, owner, 'admin');
    const adminCtx = await loadUserContext(deps, adminUser, org);
    const issued = await asTenant(org, adminUser, (tx) =>
      issueApiKey(
        tx,
        pgIamStore,
        catalog,
        adminCtx,
        { name: 'k', scopes: ['corpus:read', 'project:read:any'] },
        clock,
      ),
    );
    expect([...(await authenticateApiKey(deps, issued.plaintext)).permissions].sort()).toEqual([
      'corpus:read',
      'project:read:any',
    ]);

    // Demote admin -> viewer (viewer has corpus:read but only project:read:own).
    const ownerCtx = await loadUserContext(deps, owner, org);
    await asTenant(org, owner, async (tx) => {
      await assignRole(tx, pgIamStore, ownerCtx, adminUser, 'viewer');
      await revokeRole(tx, pgIamStore, ownerCtx, adminUser, 'admin');
    });

    expect([...(await authenticateApiKey(deps, issued.plaintext)).permissions]).toEqual([
      'corpus:read',
    ]);
  });

  describe('issuing', () => {
    it('refuses scopes that keys may never hold, and scopes beyond the issuer', async () => {
      const { issue } = await scenario();
      await rejectsWith(issue(['member:invite']), { code: 'api_key.scope_not_eligible' });
      await rejectsWith(issue(['project:update:any']), { code: 'api_key.scope_not_eligible' });

      const owner = await newUser('lim-owner');
      const org = await newOrg(owner);
      const viewer = await memberOf(org, owner, 'viewer');
      const viewerCtx = await loadUserContext(deps, viewer, org);
      // A viewer lacks api_key:create outright.
      await rejectsWith(
        asTenant(org, viewer, (tx) =>
          issueApiKey(
            tx,
            pgIamStore,
            catalog,
            viewerCtx,
            { name: 'k', scopes: ['corpus:read'] },
            clock,
          ),
        ),
        { kind: 'forbidden' },
      );
    });

    it('refuses to grant a key more than its issuer holds', async () => {
      const owner = await newUser('exc-owner');
      const org = await newOrg(owner);
      const adminUser = await memberOf(org, owner, 'admin');
      const adminCtx = await loadUserContext(deps, adminUser, org);
      // Give an admin a context stripped of project:read:any to prove the ceiling is the issuer.
      const reduced = {
        ...adminCtx,
        permissions: new Set([...adminCtx.permissions].filter((p) => p !== 'project:read:any')),
      };
      await rejectsWith(
        asTenant(org, adminUser, (tx) =>
          issueApiKey(
            tx,
            pgIamStore,
            catalog,
            reduced,
            { name: 'k', scopes: ['project:read:any'] },
            clock,
          ),
        ),
        { code: 'api_key.scope_exceeds_issuer' },
      );
    });

    it('rejects empty scopes, blank names and past expiries', async () => {
      const { issue, org, owner, ownerCtx } = await scenario();
      await rejectsWith(issue([]), { code: 'api_key.scopes_required' });
      await rejectsWith(
        issue(['corpus:read'], { expiresAt: new Date(clock.now().getTime() - 1000) }),
        {
          code: 'api_key.expiry_in_past',
        },
      );
      await rejectsWith(
        asTenant(org, owner, (tx) =>
          issueApiKey(
            tx,
            pgIamStore,
            catalog,
            ownerCtx,
            { name: '  ', scopes: ['corpus:read'] },
            clock,
          ),
        ),
        { code: 'api_key.name_invalid' },
      );
    });

    it('refuses to let an API key issue API keys', async () => {
      const { org, owner, issue } = await scenario();
      const { plaintext } = await issue();
      const keyCtx = await authenticateApiKey(deps, plaintext);
      const forged = { ...keyCtx, permissions: new Set([...keyCtx.permissions, 'api_key:create']) };
      await rejectsWith(
        asTenant(org, owner, (tx) =>
          issueApiKey(
            tx,
            pgIamStore,
            catalog,
            forged,
            { name: 'k', scopes: ['corpus:read'] },
            clock,
          ),
        ),
        { kind: 'forbidden' },
      );
    });
  });

  describe('storage', () => {
    it('never persists the plaintext secret anywhere in the row', async () => {
      const { issue, org } = await scenario();
      const { plaintext } = await issue();
      const secret = plaintext.split('_')[3] ?? '';

      const dump = await admin((c) =>
        c.query<{ row: string }>(
          'SELECT k::text AS row FROM iam.api_keys k WHERE organization_id = $1',
          [org],
        ),
      );
      expect(dump.rows).toHaveLength(1);
      expect(dump.rows[0]?.row).not.toContain(secret);
      expect(dump.rows[0]?.row).not.toContain(plaintext);
    });

    it('never returns the hash when listing keys', async () => {
      const { issue, org, owner } = await scenario();
      await issue();
      const listed = await asTenant(org, owner, (tx) => pgIamStore.listApiKeys(tx));
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty('secretHash');
    });

    it('records use at most once per interval, not on every request', async () => {
      const { issue, org } = await scenario();
      const { plaintext, record } = await issue();
      const read = async () =>
        (
          await admin((c) =>
            c.query<{ last_used_at: Date | null }>(
              'SELECT last_used_at FROM iam.api_keys WHERE id = $1',
              [record.id],
            ),
          )
        ).rows[0]?.last_used_at;

      expect(await read()).toBeNull();
      await authenticateApiKey(deps, plaintext);
      const first = await read();
      expect(first).not.toBeNull();
      await authenticateApiKey(deps, plaintext);
      expect((await read())?.getTime()).toBe(first?.getTime());
      expect(org).toBeDefined();
    });

    it('lets an organization see only its own keys', async () => {
      const a = await scenario();
      const b = await scenario();
      await a.issue();
      const seenByB = await asTenant(b.org, b.owner, (tx) =>
        tx.query<{ organization_id: string }>('SELECT organization_id FROM iam.api_keys'),
      );
      expect(seenByB.rows.every((r) => r.organization_id === b.org)).toBe(true);
    });
  });
});

// Keep the imports used only for their types honest.
export type _Unused = ApiKeyId;
