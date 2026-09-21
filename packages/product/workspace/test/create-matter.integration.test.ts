import { randomUUID } from 'node:crypto';

import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { entitlementMigrations } from '@legalintel/entitlements';
import { iamMigrations } from '@legalintel/iam';
import { ApiKeyId, OrganizationId, UserId } from '@legalintel/kernel';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ClientId, createMatter, pgWorkspaceStore, workspaceMigrations } from '../src';

describe('createMatter — PostgreSQL application boundary', () => {
  let database: TestDatabase;
  let pool: DbPool;

  const organizationId = OrganizationId.parse(randomUUID());
  const otherOrganizationId = OrganizationId.parse(randomUUID());
  const userId = UserId.parse(randomUUID());

  let ghanaJurisdictionId: JurisdictionId;
  let clientId: ClientId;

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [
        platformMigrations,
        iamMigrations,
        auditMigrations,
        corpusMigrations,
        entitlementMigrations,
        workspaceMigrations,
      ],
    });

    pool = database.poolFor('app', { max: 4 });

    const jurisdictionId = randomUUID();

    await database.withAdmin(async (client) => {
      await client.query(
        `INSERT INTO iam.users (
           id,
           email,
           display_name
         )
         VALUES ($1, $2, $3)`,
        [userId, `workspace-create-matter-${userId}@example.test`, 'Workspace Create Matter User'],
      );

      await client.query(
        `INSERT INTO iam.organizations (
           id,
           name,
           slug,
           kind
         )
         VALUES
           ($1, 'Create Matter Firm', $2, 'firm'),
           ($3, 'Other Create Matter Firm', $4, 'firm')`,
        [
          organizationId,
          `create-matter-${organizationId}`,
          otherOrganizationId,
          `other-create-matter-${otherOrganizationId}`,
        ],
      );

      await client.query(
        `INSERT INTO corpus.jurisdictions (
           id,
           code,
           name,
           kind,
           is_synthetic
         )
         VALUES ($1, 'GH', 'Ghana', 'country', false)`,
        [jurisdictionId],
      );

      await client.query(
        `INSERT INTO policy.organization_jurisdictions (
           id,
           organization_id,
           jurisdiction_id,
           status,
           granted_by
         )
         VALUES ($1, $2, $3, 'active', $4)`,
        [randomUUID(), organizationId, jurisdictionId, userId],
      );
    });

    ghanaJurisdictionId = JurisdictionId.parse(jurisdictionId);

    clientId = await withTenantTransaction(
      pool,
      {
        organizationId,
        userId,
      },
      async (tx) => {
        const client = await pgWorkspaceStore.createClient(tx, {
          name: 'Create Matter Client',
          reference: 'CLIENT-CREATE-MATTER',
        });

        return client.id;
      },
    );
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('creates a Ghana matter only after client lookup and active tenant entitlement resolution, then audits it', async () => {
    const matter = await withTenantTransaction(
      pool,
      {
        organizationId,
        userId,
      },
      async (tx) =>
        createMatter(
          {
            workspaceStore: pgWorkspaceStore,
          },
          tx,
          {
            principal: {
              kind: 'user',
              userId,
            },
            organizationId,
            roles: [],
            permissions: new Set(['matter:create']),
          },
          {
            clientId,
            name: 'Ghana Commercial Matter',
            reference: 'MAT-GH-001',
          },
        ),
    );

    expect(matter.organizationId).toBe(organizationId);
    expect(matter.clientId).toBe(clientId);
    expect(matter.jurisdictionId).toBe(ghanaJurisdictionId);
    expect(matter.name).toBe('Ghana Commercial Matter');
    expect(matter.reference).toBe('MAT-GH-001');
    expect(matter.status).toBe('open');

    await withTenantTransaction(
      pool,
      {
        organizationId,
        userId,
      },
      async (tx) => {
        const persisted = await pgWorkspaceStore.findMatterById(tx, matter.id);

        expect(persisted).not.toBeNull();
        expect(persisted?.jurisdictionId).toBe(ghanaJurisdictionId);

        const audit = await tx.query<{
          actor_kind: string;
          actor_id: string | null;
          action: string;
          resource_type: string | null;
          resource_id: string | null;
          outcome: string;
          metadata: Record<string, unknown>;
        }>(
          `SELECT
             actor_kind,
             actor_id,
             action,
             resource_type,
             resource_id,
             outcome,
             metadata
           FROM audit.events
           WHERE action = 'workspace.matter_created'
             AND resource_id = $1`,
          [matter.id],
        );

        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
          actor_kind: 'user',
          actor_id: userId,
          action: 'workspace.matter_created',
          resource_type: 'matter',
          resource_id: matter.id,
          outcome: 'success',
        });

        expect(JSON.stringify(audit.rows[0]?.metadata ?? {})).not.toContain(
          'Ghana Commercial Matter',
        );
      },
    );
  });

  it('rejects matter creation when Ghana is not entitled for the current tenant and writes no matter or success audit event', async () => {
    const otherClientId = await withTenantTransaction(
      pool,
      {
        organizationId: otherOrganizationId,
        userId,
      },
      async (tx) => {
        const client = await pgWorkspaceStore.createClient(tx, {
          name: 'Other Tenant Client',
          reference: 'OTHER-CLIENT',
        });

        return client.id;
      },
    );

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: otherOrganizationId,
          userId,
        },
        async (tx) =>
          createMatter(
            {
              workspaceStore: pgWorkspaceStore,
            },
            tx,
            {
              principal: {
                kind: 'user',
                userId,
              },
              organizationId: otherOrganizationId,
              roles: [],
              permissions: new Set(['matter:create']),
            },
            {
              clientId: otherClientId,
              name: 'Must Not Persist',
              reference: 'DENIED-GH-001',
            },
          ),
      ),
    ).rejects.toMatchObject({
      code: 'JURISDICTION_NOT_ENTITLED',
    });

    await withTenantTransaction(
      pool,
      {
        organizationId: otherOrganizationId,
        userId,
      },
      async (tx) => {
        const matters = await pgWorkspaceStore.listMatters(tx);

        expect(matters).toHaveLength(0);

        const audit = await tx.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM audit.events
           WHERE action = 'workspace.matter_created'
             AND outcome = 'success'`,
        );

        expect(audit.rows[0]?.count).toBe('0');
      },
    );
  });

  it('cannot create a matter using a client owned by another organization', async () => {
    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: otherOrganizationId,
          userId,
        },
        async (tx) =>
          createMatter(
            {
              workspaceStore: pgWorkspaceStore,
            },
            tx,
            {
              principal: {
                kind: 'user',
                userId,
              },
              organizationId: otherOrganizationId,
              roles: [],
              permissions: new Set(['matter:create']),
            },
            {
              clientId,
              name: 'Cross Tenant Matter',
              reference: 'CROSS-TENANT-001',
            },
          ),
      ),
    ).rejects.toMatchObject({
      name: 'workspace.client_not_found',
    });
  });

  it('rejects before persistence when the caller lacks matter:create', async () => {
    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId,
          userId,
        },
        async (tx) =>
          createMatter(
            {
              workspaceStore: pgWorkspaceStore,
            },
            tx,
            {
              principal: {
                kind: 'user',
                userId,
              },
              organizationId,
              roles: [],
              permissions: new Set(),
            },
            {
              clientId,
              name: 'Unauthorized Matter',
              reference: 'NO-PERMISSION-001',
            },
          ),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    await withTenantTransaction(
      pool,
      {
        organizationId,
        userId,
      },
      async (tx) => {
        const matters = await pgWorkspaceStore.listMatters(tx);

        expect(matters.some((matter) => matter.reference === 'NO-PERMISSION-001')).toBe(false);
      },
    );
  });

  it('defaults an omitted jurisdiction to Ghana and persists the canonical Ghana jurisdiction', async () => {
    const matter = await withTenantTransaction(pool, { organizationId }, async (tx) =>
      createMatter(
        { workspaceStore: pgWorkspaceStore },
        tx,
        {
          principal: { kind: 'user', userId },
          organizationId,
          permissions: new Set(['matter:create']),
          roles: [],
        },
        {
          clientId,
          name: 'Implicit Ghana matter',
        },
      ),
    );

    expect(matter.jurisdictionId).toBe(ghanaJurisdictionId);

    const persisted = await withTenantTransaction(pool, { organizationId }, (tx) =>
      pgWorkspaceStore.findMatterById(tx, matter.id),
    );

    expect(persisted?.jurisdictionId).toBe(ghanaJurisdictionId);
  });

  it('accepts explicit GH and persists the canonical Ghana jurisdiction', async () => {
    const matter = await withTenantTransaction(pool, { organizationId }, async (tx) =>
      createMatter(
        { workspaceStore: pgWorkspaceStore },
        tx,
        {
          principal: { kind: 'user', userId },
          organizationId,
          permissions: new Set(['matter:create']),
          roles: [],
        },
        {
          clientId,
          name: 'Explicit Ghana matter',
          jurisdiction: 'GH',
        },
      ),
    );

    expect(matter.jurisdictionId).toBe(ghanaJurisdictionId);

    const persisted = await withTenantTransaction(pool, { organizationId }, (tx) =>
      pgWorkspaceStore.findMatterById(tx, matter.id),
    );

    expect(persisted?.jurisdictionId).toBe(ghanaJurisdictionId);
  });

  it('rejects matter creation after the Ghana entitlement is revoked', async () => {
    await database.withAdmin(async (admin) => {
      await admin.query(
        `UPDATE policy.organization_jurisdictions
         SET
           status = 'revoked',
           revoked_at = clock_timestamp(),
           revoked_by = $3
         WHERE organization_id = $1
           AND jurisdiction_id = $2`,
        [organizationId, ghanaJurisdictionId, userId],
      );
    });

    try {
      const before = await withTenantTransaction(pool, { organizationId }, (tx) =>
        pgWorkspaceStore.listMatters(tx),
      );

      await expect(
        withTenantTransaction(pool, { organizationId }, async (tx) =>
          createMatter(
            { workspaceStore: pgWorkspaceStore },
            tx,
            {
              principal: { kind: 'user', userId },
              organizationId,
              permissions: new Set(['matter:create']),
              roles: [],
            },
            {
              clientId,
              name: 'Revoked Ghana entitlement matter',
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: 'JURISDICTION_NOT_ENTITLED',
      });

      const after = await withTenantTransaction(pool, { organizationId }, (tx) =>
        pgWorkspaceStore.listMatters(tx),
      );

      expect(after).toHaveLength(before.length);
    } finally {
      await database.withAdmin(async (admin) => {
        await admin.query(
          `UPDATE policy.organization_jurisdictions
           SET
             status = 'active',
             revoked_at = NULL,
             revoked_by = NULL
           WHERE organization_id = $1
             AND jurisdiction_id = $2`,
          [organizationId, ghanaJurisdictionId],
        );
      });
    }
  });

  it('attributes an API-key matter creation audit event to the user who created the key', async () => {
    const apiKeyId = ApiKeyId.parse(randomUUID());
    const apiKeyCreatorId = UserId.parse(randomUUID());

    const matter = await withTenantTransaction(pool, { organizationId }, async (tx) =>
      createMatter(
        { workspaceStore: pgWorkspaceStore },
        tx,
        {
          principal: {
            kind: 'api_key',
            apiKeyId,
            createdBy: apiKeyCreatorId,
          },
          organizationId,
          permissions: new Set(['matter:create']),
          roles: [],
        },
        {
          clientId,
          name: 'API key Ghana matter',
        },
      ),
    );

    const audit = await withTenantTransaction(pool, { organizationId }, (tx) =>
      tx.query<{
        actor_kind: string;
        actor_id: string | null;
        resource_id: string | null;
      }>(
        `SELECT actor_kind, actor_id, resource_id
           FROM audit.events
           WHERE action = 'workspace.matter_created'
             AND resource_id = $1`,
        [matter.id],
      ),
    );

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_kind: 'api_key',
      actor_id: apiKeyCreatorId,
      resource_id: matter.id,
    });
  });

  it('rolls matter creation back when the audit write fails in the same tenant transaction', async () => {
    const matterName = `Audit rollback Ghana matter ${randomUUID()}`;

    await expect(
      withTenantTransaction(pool, { organizationId }, async (tx) => {
        await tx.query(
          `ALTER TABLE audit.events
             ADD CONSTRAINT phase_3b2b_reject_workspace_matter_created
             CHECK (action <> 'workspace.matter_created')`,
        );

        return createMatter(
          { workspaceStore: pgWorkspaceStore },
          tx,
          {
            principal: { kind: 'user', userId },
            organizationId,
            permissions: new Set(['matter:create']),
            roles: [],
          },
          {
            clientId,
            name: matterName,
          },
        );
      }),
    ).rejects.toBeDefined();

    const matters = await withTenantTransaction(pool, { organizationId }, (tx) =>
      pgWorkspaceStore.listMatters(tx),
    );

    expect(matters.some((matter) => matter.name === matterName)).toBe(false);

    const constraint = await database.withAdmin((admin) =>
      admin.query<{ constraint_name: string }>(
        `SELECT conname AS constraint_name
         FROM pg_constraint
         WHERE conname = 'phase_3b2b_reject_workspace_matter_created'`,
      ),
    );

    expect(constraint.rows).toHaveLength(0);
  });
});
