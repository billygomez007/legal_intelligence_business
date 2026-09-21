import { randomUUID } from 'node:crypto';

import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { OrganizationId } from '@legalintel/kernel';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pgWorkspaceStore, workspaceMigrations } from '../src';
import type { ClientId } from '../src';

describe('PgWorkspaceStore', () => {
  let database: TestDatabase;
  let pool: DbPool;

  const organizationA = OrganizationId.parse(randomUUID());
  const organizationB = OrganizationId.parse(randomUUID());

  let ghanaJurisdictionId: JurisdictionId;

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, corpusMigrations, workspaceMigrations],
    });

    pool = database.poolFor('app', { max: 8 });

    await database.withAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO iam.organizations (id, name, slug, kind)
         VALUES
           ($1, 'Workspace Store Firm A', $2, 'firm'),
           ($3, 'Workspace Store Firm B', $4, 'firm')`,
        [
          organizationA,
          `workspace-store-a-${organizationA}`,
          organizationB,
          `workspace-store-b-${organizationB}`,
        ],
      );

      const jurisdiction = await tx.query<{ id: string }>(
        `INSERT INTO corpus.jurisdictions
           (code, name, kind, is_synthetic)
         VALUES
           ('GH', 'Ghana', 'country', false)
         RETURNING id`,
      );

      const id = jurisdiction.rows[0]?.id;

      if (id === undefined) {
        throw new Error('Ghana jurisdiction fixture was not created.');
      }

      ghanaJurisdictionId = JurisdictionId.parse(id);
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('creates, reads, lists and updates a tenant client', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const created = await pgWorkspaceStore.createClient(tx, {
        name: 'Akosua Holdings Ltd',
        reference: 'CLIENT-001',
      });

      expect(created.name).toBe('Akosua Holdings Ltd');
      expect(created.reference).toBe('CLIENT-001');
      expect(created.status).toBe('active');

      const found = await pgWorkspaceStore.findClientById(tx, created.id);

      expect(found?.id).toBe(created.id);

      const listed = await pgWorkspaceStore.listClients(tx);

      expect(listed.some((client) => client.id === created.id)).toBe(true);

      const updated = await pgWorkspaceStore.updateClient(tx, created.id, {
        name: 'Akosua Holdings Ghana Ltd',
        reference: null,
        status: 'archived',
      });

      expect(updated?.name).toBe('Akosua Holdings Ghana Ltd');
      expect(updated?.reference).toBeNull();
      expect(updated?.status).toBe('archived');
    });
  });

  it('creates, reads, lists and closes a Ghana matter', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, {
        name: 'Matter Client',
      });

      const matter = await pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: ghanaJurisdictionId,
        name: 'Commercial dispute',
        reference: 'MATTER-001',
      });

      expect(matter.clientId).toBe(client.id);
      expect(matter.jurisdictionId).toBe(ghanaJurisdictionId);
      expect(matter.status).toBe('open');
      expect(matter.closedAt).toBeNull();

      const found = await pgWorkspaceStore.findMatterById(tx, matter.id);

      expect(found?.id).toBe(matter.id);

      const allMatters = await pgWorkspaceStore.listMatters(tx);
      const clientMatters = await pgWorkspaceStore.listMattersForClient(tx, client.id);

      expect(allMatters.some((row) => row.id === matter.id)).toBe(true);
      expect(clientMatters.some((row) => row.id === matter.id)).toBe(true);

      const closed = await pgWorkspaceStore.updateMatter(tx, matter.id, {
        status: 'closed',
      });

      expect(closed?.status).toBe('closed');
      expect(closed?.closedAt).toBeInstanceOf(Date);

      const reopened = await pgWorkspaceStore.updateMatter(tx, matter.id, {
        status: 'open',
      });

      expect(reopened?.status).toBe('open');
      expect(reopened?.closedAt).toBeNull();
    });
  });

  it('does not expose another organization client or matter', async () => {
    let clientId: ClientId;
    let matterId: Awaited<ReturnType<typeof pgWorkspaceStore.createMatter>>['id'];

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, {
        name: 'Private Client A',
      });

      const matter = await pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: ghanaJurisdictionId,
        name: 'Private Matter A',
      });

      clientId = client.id;
      matterId = matter.id;
    });

    await withTenantTransaction(pool, { organizationId: organizationB }, async (tx) => {
      expect(await pgWorkspaceStore.findClientById(tx, clientId)).toBeNull();

      expect(await pgWorkspaceStore.findMatterById(tx, matterId)).toBeNull();

      const clients = await pgWorkspaceStore.listClients(tx);
      const matters = await pgWorkspaceStore.listMatters(tx);

      expect(clients.some((row) => row.id === clientId)).toBe(false);
      expect(matters.some((row) => row.id === matterId)).toBe(false);
    });
  });

  it('cannot create a matter against another organization client', async () => {
    let foreignClientId: ClientId;

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      foreignClientId = (
        await pgWorkspaceStore.createClient(tx, {
          name: 'Firm A Client',
        })
      ).id;
    });

    await withTenantTransaction(pool, { organizationId: organizationB }, async (tx) => {
      await expect(
        pgWorkspaceStore.createMatter(tx, {
          clientId: foreignClientId,
          jurisdictionId: ghanaJurisdictionId,
          name: 'Forbidden cross-tenant matter',
        }),
      ).rejects.toMatchObject({
        code: 'workspace.client_not_found',
      });
    });
  });

  it('rejects a matter with a nonexistent canonical jurisdiction', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, {
        name: 'Jurisdiction Test Client',
      });

      await expect(
        pgWorkspaceStore.createMatter(tx, {
          clientId: client.id,
          jurisdictionId: JurisdictionId.parse(randomUUID()),
          name: 'Invalid jurisdiction matter',
        }),
      ).rejects.toMatchObject({
        code: 'workspace.jurisdiction_not_found',
      });
    });
  });
});
