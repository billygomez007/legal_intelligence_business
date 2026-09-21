import { randomUUID } from 'node:crypto';

import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { OrganizationId, UserId } from '@legalintel/kernel';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createClient,
  getClient,
  getMatter,
  listClients,
  listMatters,
  listMattersForClient,
  pgWorkspaceStore,
  updateClient,
  updateMatter,
  workspaceMigrations,
} from '../src';

describe('workspace application boundary — PostgreSQL', () => {
  let database: TestDatabase;
  let pool: DbPool;

  const organizationId = OrganizationId.parse(randomUUID());
  const otherOrganizationId = OrganizationId.parse(randomUUID());
  const userId = UserId.parse(randomUUID());

  let ghanaJurisdictionId: JurisdictionId;

  const readContext = {
    principal: {
      kind: 'user' as const,
      userId,
    },
    organizationId,
    roles: [],
    permissions: new Set(['client:read', 'matter:read']),
  };

  const fullContext = {
    principal: {
      kind: 'user' as const,
      userId,
    },
    organizationId,
    roles: [],
    permissions: new Set([
      'client:create',
      'client:read',
      'client:update',
      'matter:create',
      'matter:read',
      'matter:update',
    ]),
  };

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [
        platformMigrations,
        iamMigrations,
        auditMigrations,
        corpusMigrations,
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
        [userId, `workspace-phase-3c-${userId}@example.test`, 'Workspace Phase 3C User'],
      );

      await client.query(
        `INSERT INTO iam.organizations (
           id,
           name,
           slug,
           kind
         )
         VALUES
           ($1, 'Phase 3C Ghana Firm', $2, 'firm'),
           ($3, 'Phase 3C Other Firm', $4, 'firm')`,
        [
          organizationId,
          `phase-3c-${organizationId}`,
          otherOrganizationId,
          `phase-3c-other-${otherOrganizationId}`,
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
    });

    ghanaJurisdictionId = JurisdictionId.parse(jurisdictionId);
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('creates a client and records the mutation audit event', async () => {
    const client = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      createClient({ workspaceStore: pgWorkspaceStore }, tx, fullContext, {
        name: 'Akosua Holdings Ltd',
        reference: 'CLIENT-GH-001',
      }),
    );

    expect(client.organizationId).toBe(organizationId);
    expect(client.name).toBe('Akosua Holdings Ltd');
    expect(client.reference).toBe('CLIENT-GH-001');
    expect(client.status).toBe('active');

    await withTenantTransaction(pool, { organizationId, userId }, async (tx) => {
      const persisted = await pgWorkspaceStore.findClientById(tx, client.id);

      expect(persisted).not.toBeNull();

      const audit = await tx.query<{
        actor_kind: string;
        actor_id: string | null;
        action: string;
        resource_type: string | null;
        resource_id: string | null;
      }>(
        `SELECT
             actor_kind,
             actor_id,
             action,
             resource_type,
             resource_id
           FROM audit.events
           WHERE action = 'workspace.client_created'
             AND resource_id = $1`,
        [client.id],
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        actor_kind: 'user',
        actor_id: userId,
        action: 'workspace.client_created',
        resource_type: 'client',
        resource_id: client.id,
      });
    });
  });

  it('gets and lists only clients visible to the current tenant', async () => {
    const ownClient = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createClient(tx, {
        name: 'Own Ghana Client',
        reference: 'OWN-GH',
      }),
    );

    const otherClient = await withTenantTransaction(
      pool,
      {
        organizationId: otherOrganizationId,
        userId,
      },
      (tx) =>
        pgWorkspaceStore.createClient(tx, {
          name: 'Other Organization Client',
          reference: 'OTHER-CLIENT',
        }),
    );

    const found = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      getClient({ workspaceStore: pgWorkspaceStore }, tx, readContext, ownClient.id),
    );

    expect(found.id).toBe(ownClient.id);

    const listed = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      listClients({ workspaceStore: pgWorkspaceStore }, tx, readContext),
    );

    expect(listed.some((client) => client.id === ownClient.id)).toBe(true);
    expect(listed.some((client) => client.id === otherClient.id)).toBe(false);

    await expect(
      withTenantTransaction(pool, { organizationId, userId }, (tx) =>
        getClient({ workspaceStore: pgWorkspaceStore }, tx, readContext, otherClient.id),
      ),
    ).rejects.toMatchObject({
      name: 'workspace.client_not_found',
    });
  });

  it('updates a client and audits the mutation', async () => {
    const client = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createClient(tx, {
        name: 'Client Before Update',
        reference: 'CLIENT-BEFORE',
      }),
    );

    const updated = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      updateClient({ workspaceStore: pgWorkspaceStore }, tx, fullContext, client.id, {
        name: 'Client After Update',
        status: 'archived',
      }),
    );

    expect(updated.name).toBe('Client After Update');
    expect(updated.status).toBe('archived');

    await withTenantTransaction(pool, { organizationId, userId }, async (tx) => {
      const audit = await tx.query<{
        actor_id: string | null;
        action: string;
        resource_id: string | null;
      }>(
        `SELECT actor_id, action, resource_id
           FROM audit.events
           WHERE action = 'workspace.client_updated'
             AND resource_id = $1`,
        [client.id],
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        actor_id: userId,
        action: 'workspace.client_updated',
        resource_id: client.id,
      });
    });
  });

  it('gets and lists Ghana matters only inside the current tenant boundary', async () => {
    const client = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createClient(tx, {
        name: 'Matter Client',
        reference: 'MATTER-CLIENT',
      }),
    );

    const matter = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: ghanaJurisdictionId,
        name: 'Ghana Litigation Matter',
        reference: 'MAT-GH-003',
      }),
    );

    const otherClient = await withTenantTransaction(
      pool,
      {
        organizationId: otherOrganizationId,
        userId,
      },
      (tx) =>
        pgWorkspaceStore.createClient(tx, {
          name: 'Other Matter Client',
        }),
    );

    const otherMatter = await withTenantTransaction(
      pool,
      {
        organizationId: otherOrganizationId,
        userId,
      },
      (tx) =>
        pgWorkspaceStore.createMatter(tx, {
          clientId: otherClient.id,
          jurisdictionId: ghanaJurisdictionId,
          name: 'Other Organization Ghana Matter',
        }),
    );

    const found = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      getMatter({ workspaceStore: pgWorkspaceStore }, tx, readContext, matter.id),
    );

    expect(found.id).toBe(matter.id);
    expect(found.jurisdictionId).toBe(ghanaJurisdictionId);

    const matters = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      listMatters({ workspaceStore: pgWorkspaceStore }, tx, readContext),
    );

    expect(matters.some((row) => row.id === matter.id)).toBe(true);
    expect(matters.some((row) => row.id === otherMatter.id)).toBe(false);

    const clientMatters = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      listMattersForClient({ workspaceStore: pgWorkspaceStore }, tx, readContext, client.id),
    );

    expect(clientMatters.some((row) => row.id === matter.id)).toBe(true);

    await expect(
      withTenantTransaction(pool, { organizationId, userId }, (tx) =>
        getMatter({ workspaceStore: pgWorkspaceStore }, tx, readContext, otherMatter.id),
      ),
    ).rejects.toMatchObject({
      name: 'workspace.matter_not_found',
    });
  });

  it('updates a Ghana matter lifecycle and audits the mutation', async () => {
    const client = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createClient(tx, {
        name: 'Lifecycle Client',
      }),
    );

    const matter = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: ghanaJurisdictionId,
        name: 'Lifecycle Ghana Matter',
      }),
    );

    const closed = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      updateMatter({ workspaceStore: pgWorkspaceStore }, tx, fullContext, matter.id, {
        status: 'closed',
      }),
    );

    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(closed.jurisdictionId).toBe(ghanaJurisdictionId);

    await withTenantTransaction(pool, { organizationId, userId }, async (tx) => {
      const audit = await tx.query<{
        actor_id: string | null;
        action: string;
        resource_id: string | null;
      }>(
        `SELECT actor_id, action, resource_id
           FROM audit.events
           WHERE action = 'workspace.matter_updated'
             AND resource_id = $1`,
        [matter.id],
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        actor_id: userId,
        action: 'workspace.matter_updated',
        resource_id: matter.id,
      });
    });
  });

  it('rejects client creation before persistence when client:create is missing', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId, userId }, (tx) =>
        createClient(
          { workspaceStore: pgWorkspaceStore },
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
            name: 'Must Not Be Created',
            reference: 'DENIED-CLIENT',
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    const clients = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.listClients(tx),
    );

    expect(clients.some((client) => client.reference === 'DENIED-CLIENT')).toBe(false);
  });

  it('rejects matter update when matter:update is missing', async () => {
    const client = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createClient(tx, {
        name: 'Denied Matter Client',
      }),
    );

    const matter = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: ghanaJurisdictionId,
        name: 'Matter Before Denied Update',
      }),
    );

    await expect(
      withTenantTransaction(pool, { organizationId, userId }, (tx) =>
        updateMatter(
          { workspaceStore: pgWorkspaceStore },
          tx,
          {
            principal: {
              kind: 'user',
              userId,
            },
            organizationId,
            roles: [],
            permissions: new Set(['matter:read']),
          },
          matter.id,
          {
            status: 'closed',
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    const persisted = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.findMatterById(tx, matter.id),
    );

    expect(persisted?.status).toBe('open');
    expect(persisted?.closedAt).toBeNull();
  });

  it('rolls client creation back when its audit write fails', async () => {
    const reference = `ROLLBACK-${randomUUID()}`;

    await expect(
      withTenantTransaction(pool, { organizationId, userId }, async (tx) => {
        await tx.query(
          `ALTER TABLE audit.events
             ADD CONSTRAINT phase_3c_reject_workspace_client_created
             CHECK (action <> 'workspace.client_created')`,
        );

        return createClient({ workspaceStore: pgWorkspaceStore }, tx, fullContext, {
          name: 'Rolled Back Client',
          reference,
        });
      }),
    ).rejects.toBeDefined();

    const clients = await withTenantTransaction(pool, { organizationId, userId }, (tx) =>
      pgWorkspaceStore.listClients(tx),
    );

    expect(clients.some((client) => client.reference === reference)).toBe(false);

    const constraint = await database.withAdmin((admin) =>
      admin.query<{ constraint_name: string }>(
        `SELECT conname AS constraint_name
         FROM pg_constraint
         WHERE conname = 'phase_3c_reject_workspace_client_created'`,
      ),
    );

    expect(constraint.rows).toHaveLength(0);
  });
});
