import { randomUUID } from 'node:crypto';

import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workspaceMigrations } from '../src/migrations';

type TenantScope = Parameters<typeof withTenantTransaction>[1];
type OrganizationId = TenantScope['organizationId'];

describe('workspace clients and matters — PostgreSQL boundary', () => {
  let database!: TestDatabase;
  let pool!: DbPool;

  const orgA = randomUUID() as OrganizationId;
  const orgB = randomUUID() as OrganizationId;

  let ghId!: JurisdictionId;

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, corpusMigrations, workspaceMigrations],
    });

    pool = database.poolFor('app', {
      max: 8,
    });

    await database.withAdmin(async (client) => {
      await client.query(
        `INSERT INTO iam.organizations (
           id,
           name,
           slug,
           kind
         )
         VALUES
           ($1, $2, $3, 'firm'),
           ($4, $5, $6, 'firm')`,
        [
          orgA,
          'Phase 3A Organization A',
          `phase3a-a-${orgA}`,
          orgB,
          'Phase 3A Organization B',
          `phase3a-b-${orgB}`,
        ],
      );

      const jurisdiction = await client.query<{ id: string }>(
        `INSERT INTO corpus.jurisdictions (
           code,
           name,
           kind,
           is_synthetic
         )
         VALUES ('GH', 'Ghana', 'country', false)
         RETURNING id`,
      );

      const row = jurisdiction.rows[0];

      if (!row) {
        throw new Error('Ghana jurisdiction was not created.');
      }

      ghId = JurisdictionId.parse(row.id);
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('installs clients and matters with tenant RLS enabled and forced', async () => {
    const result = await database.withAdmin((client) =>
      client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`
        SELECT
          c.relname,
          c.relrowsecurity,
          c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = 'workspace'
          AND c.relname IN ('clients', 'matters')
        ORDER BY c.relname
      `),
    );

    expect(result.rows).toEqual([
      {
        relname: 'clients',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: 'matters',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);
  });

  it('gives the runtime application read/write access but no delete or truncate privilege', async () => {
    const result = await database.withAdmin((client) =>
      client.query<{
        table_name: string;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>(`
        SELECT
          table_name,
          has_table_privilege(
            'legalintel_app',
            format('workspace.%I', table_name),
            'SELECT'
          ) AS can_select,
          has_table_privilege(
            'legalintel_app',
            format('workspace.%I', table_name),
            'INSERT'
          ) AS can_insert,
          has_table_privilege(
            'legalintel_app',
            format('workspace.%I', table_name),
            'UPDATE'
          ) AS can_update,
          has_table_privilege(
            'legalintel_app',
            format('workspace.%I', table_name),
            'DELETE'
          ) AS can_delete,
          has_table_privilege(
            'legalintel_app',
            format('workspace.%I', table_name),
            'TRUNCATE'
          ) AS can_truncate
        FROM (
          VALUES ('clients'), ('matters')
        ) AS tables(table_name)
        ORDER BY table_name
      `),
    );

    expect(result.rows).toEqual([
      {
        table_name: 'clients',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
        can_truncate: false,
      },
      {
        table_name: 'matters',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
        can_truncate: false,
      },
    ]);
  });

  it('keeps clients and matters isolated to the current organization', async () => {
    const clientA = randomUUID();
    const matterA = randomUUID();

    await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      async (tx) => {
        await tx.query(
          `INSERT INTO workspace.clients (
             organization_id,
             id,
             name,
             reference
           )
           VALUES ($1, $2, $3, $4)`,
          [orgA, clientA, 'Organization A Client', 'CLIENT-A'],
        );

        await tx.query(
          `INSERT INTO workspace.matters (
             organization_id,
             id,
             client_id,
             jurisdiction_id,
             name,
             reference,
             status
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'open')`,
          [orgA, matterA, clientA, ghId, 'Organization A Matter', 'MATTER-A'],
        );
      },
    );

    const seenByA = await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      async (tx) => {
        const clients = await tx.query<{
          id: string;
          organization_id: string;
        }>(
          `SELECT id, organization_id
           FROM workspace.clients
           ORDER BY id`,
        );

        const matters = await tx.query<{
          id: string;
          organization_id: string;
          jurisdiction_id: string;
        }>(
          `SELECT id, organization_id, jurisdiction_id
           FROM workspace.matters
           ORDER BY id`,
        );

        return {
          clients: clients.rows,
          matters: matters.rows,
        };
      },
    );

    expect(seenByA.clients).toEqual([
      {
        id: clientA,
        organization_id: orgA,
      },
    ]);

    expect(seenByA.matters).toEqual([
      {
        id: matterA,
        organization_id: orgA,
        jurisdiction_id: ghId,
      },
    ]);

    const seenByB = await withTenantTransaction(
      pool,
      {
        organizationId: orgB,
      },
      async (tx) => {
        const clients = await tx.query<{ id: string }>(
          `SELECT id
           FROM workspace.clients`,
        );

        const matters = await tx.query<{ id: string }>(
          `SELECT id
           FROM workspace.matters`,
        );

        return {
          clients: clients.rows,
          matters: matters.rows,
        };
      },
    );

    expect(seenByB).toEqual({
      clients: [],
      matters: [],
    });
  });

  it('rejects writing a client for another organization through the tenant runtime', async () => {
    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgA,
        },
        (tx) =>
          tx.query(
            `INSERT INTO workspace.clients (
               organization_id,
               id,
               name
             )
             VALUES ($1, $2, $3)`,
            [orgB, randomUUID(), 'Cross-tenant Client'],
          ),
      ),
    ).rejects.toThrow();
  });

  it('rejects a matter that tries to use another organizations client', async () => {
    const clientB = randomUUID();

    await withTenantTransaction(
      pool,
      {
        organizationId: orgB,
      },
      (tx) =>
        tx.query(
          `INSERT INTO workspace.clients (
             organization_id,
             id,
             name
           )
           VALUES ($1, $2, $3)`,
          [orgB, clientB, 'Organization B Client'],
        ),
    );

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgA,
        },
        (tx) =>
          tx.query(
            `INSERT INTO workspace.matters (
               organization_id,
               id,
               client_id,
               jurisdiction_id,
               name,
               status
             )
             VALUES ($1, $2, $3, $4, $5, 'open')`,
            [orgA, randomUUID(), clientB, ghId, 'Invalid Cross-Tenant Matter'],
          ),
      ),
    ).rejects.toThrow();
  });

  it('requires a canonical corpus jurisdiction for every matter', async () => {
    const clientA = randomUUID();

    await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      (tx) =>
        tx.query(
          `INSERT INTO workspace.clients (
             organization_id,
             id,
             name
           )
           VALUES ($1, $2, $3)`,
          [orgA, clientA, 'Jurisdiction Test Client'],
        ),
    );

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgA,
        },
        (tx) =>
          tx.query(
            `INSERT INTO workspace.matters (
               organization_id,
               id,
               client_id,
               jurisdiction_id,
               name,
               status
             )
             VALUES ($1, $2, $3, $4, $5, 'open')`,
            [orgA, randomUUID(), clientA, randomUUID(), 'Matter With Unknown Jurisdiction'],
          ),
      ),
    ).rejects.toThrow();
  });

  it('enforces matter closed-state consistency', async () => {
    const clientA = randomUUID();

    await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      (tx) =>
        tx.query(
          `INSERT INTO workspace.clients (
             organization_id,
             id,
             name
           )
           VALUES ($1, $2, $3)`,
          [orgA, clientA, 'Lifecycle Test Client'],
        ),
    );

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgA,
        },
        (tx) =>
          tx.query(
            `INSERT INTO workspace.matters (
               organization_id,
               id,
               client_id,
               jurisdiction_id,
               name,
               status,
               closed_at
             )
             VALUES ($1, $2, $3, $4, $5, 'closed', NULL)`,
            [orgA, randomUUID(), clientA, ghId, 'Invalid Closed Matter'],
          ),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgA,
        },
        (tx) =>
          tx.query(
            `INSERT INTO workspace.matters (
               organization_id,
               id,
               client_id,
               jurisdiction_id,
               name,
               status,
               closed_at
             )
             VALUES ($1, $2, $3, $4, $5, 'open', clock_timestamp())`,
            [orgA, randomUUID(), clientA, ghId, 'Invalid Open Matter'],
          ),
      ),
    ).rejects.toThrow();
  });
});
