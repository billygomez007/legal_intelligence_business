import { randomUUID } from 'node:crypto';

import { platformMigrations, withTenantTransaction, type DbPool, type Tx } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { OrganizationId } from '@legalintel/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { knowledgeMigrations } from '../src/index.js';

describe('Firm Knowledge PostgreSQL boundary', () => {
  let database: TestDatabase;
  let pool: DbPool;

  const organizationA = OrganizationId.parse(randomUUID());
  const organizationB = OrganizationId.parse(randomUUID());

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, knowledgeMigrations],
    });

    pool = database.poolFor('app', { max: 4 });

    await database.withAdmin(async (client) => {
      await client.query(
        `INSERT INTO iam.organizations (
           id,
           name,
           slug,
           kind
         )
         VALUES
           ($1, 'Firm Knowledge Ghana A', $2, 'firm'),
           ($3, 'Firm Knowledge Ghana B', $4, 'firm')`,
        [
          organizationA,
          `knowledge-a-${organizationA}`,
          organizationB,
          `knowledge-b-${organizationB}`,
        ],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  async function insertSource(
    tx: Tx,
    organizationId: OrganizationId,
    options: {
      id?: string;
      name?: string;
      status?: 'active' | 'archived';
    } = {},
  ): Promise<string> {
    const id = options.id ?? randomUUID();

    await tx.query(
      `INSERT INTO knowledge.sources (
         organization_id,
         id,
         name,
         description,
         status
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        organizationId,
        id,
        options.name ?? 'Firm Knowledge Source',
        'Private internal Ghana firm material',
        options.status ?? 'active',
      ],
    );

    return id;
  }

  async function insertVersion(
    tx: Tx,
    organizationId: OrganizationId,
    sourceId: string,
    options: {
      id?: string;
      versionNumber?: number;
      storageKey?: string;
    } = {},
  ): Promise<string> {
    const id = options.id ?? randomUUID();

    await tx.query(
      `INSERT INTO knowledge.source_versions (
         organization_id,
         id,
         source_id,
         version_number,
         original_filename,
         mime_type,
         storage_key,
         content_sha256,
         size_bytes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        organizationId,
        id,
        sourceId,
        options.versionNumber ?? 1,
        'internal-guidance.txt',
        'text/plain',
        options.storageKey ?? `firm-knowledge/${organizationId}/${id}.txt`,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        128,
      ],
    );

    return id;
  }

  it('installs both Firm Knowledge tables with enabled and forced tenant RLS', async () => {
    const result = await database.withAdmin((client) =>
      client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT
           c.relname,
           c.relrowsecurity,
           c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n
           ON n.oid = c.relnamespace
         WHERE n.nspname = 'knowledge'
           AND c.relname IN ('sources', 'source_versions')
         ORDER BY c.relname`,
      ),
    );

    expect(result.rows).toEqual([
      {
        relname: 'source_versions',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: 'sources',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);
  });

  it('isolates sources and source versions between organizations', async () => {
    let sourceId = '';
    let versionId = '';

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      sourceId = await insertSource(tx, organizationA);
      versionId = await insertVersion(tx, organizationA, sourceId);

      const source = await tx.query<{ id: string }>(
        `SELECT id
           FROM knowledge.sources
           WHERE id = $1`,
        [sourceId],
      );

      const version = await tx.query<{ id: string }>(
        `SELECT id
           FROM knowledge.source_versions
           WHERE id = $1`,
        [versionId],
      );

      expect(source.rows).toHaveLength(1);
      expect(version.rows).toHaveLength(1);
    });

    await withTenantTransaction(pool, { organizationId: organizationB }, async (tx) => {
      const source = await tx.query<{ id: string }>(
        `SELECT id
           FROM knowledge.sources
           WHERE id = $1`,
        [sourceId],
      );

      const version = await tx.query<{ id: string }>(
        `SELECT id
           FROM knowledge.source_versions
           WHERE id = $1`,
        [versionId],
      );

      expect(source.rows).toHaveLength(0);
      expect(version.rows).toHaveLength(0);

      const update = await tx.query<{ id: string }>(
        `UPDATE knowledge.sources
           SET status = 'archived'
           WHERE id = $1
           RETURNING id`,
        [sourceId],
      );

      expect(update.rows).toHaveLength(0);
    });
  });

  it('rejects a cross-organization source-version relationship at the database boundary', async () => {
    let sourceId = '';

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      sourceId = await insertSource(tx, organizationA);
    });

    await expect(
      withTenantTransaction(pool, { organizationId: organizationB }, async (tx) => {
        await insertVersion(tx, organizationB, sourceId, {
          storageKey: `firm-knowledge/${organizationB}/${randomUUID()}.txt`,
        });
      }),
    ).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('allows non-destructive source archival while retaining historical versions', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const sourceId = await insertSource(tx, organizationA);
      const versionId = await insertVersion(tx, organizationA, sourceId);

      const archived = await tx.query<{
        id: string;
        status: string;
      }>(
        `UPDATE knowledge.sources
           SET status = 'archived'
           WHERE id = $1
           RETURNING id, status`,
        [sourceId],
      );

      expect(archived.rows).toEqual([
        {
          id: sourceId,
          status: 'archived',
        },
      ]);

      const source = await tx.query<{
        id: string;
        status: string;
      }>(
        `SELECT id, status
           FROM knowledge.sources
           WHERE id = $1`,
        [sourceId],
      );

      const version = await tx.query<{ id: string }>(
        `SELECT id
           FROM knowledge.source_versions
           WHERE id = $1`,
        [versionId],
      );

      expect(source.rows).toEqual([
        {
          id: sourceId,
          status: 'archived',
        },
      ]);

      expect(version.rows).toHaveLength(1);
    });
  });

  it('denies DELETE on knowledge sources to the application runtime role', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const sourceId = await insertSource(tx, organizationA);

      await expect(
        tx.query(
          `DELETE FROM knowledge.sources
             WHERE id = $1`,
          [sourceId],
        ),
      ).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('keeps source versions immutable to the application runtime role', async () => {
    let sourceId = '';
    let versionId = '';

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      sourceId = await insertSource(tx, organizationA);
      versionId = await insertVersion(tx, organizationA, sourceId);
    });

    await expect(
      withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
        await tx.query(
          `UPDATE knowledge.source_versions
             SET storage_key = $2
             WHERE id = $1`,
          [versionId, `firm-knowledge/${organizationA}/${randomUUID()}-changed.txt`],
        );
      }),
    ).rejects.toMatchObject({
      code: '42501',
    });

    await expect(
      withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
        await tx.query(
          `DELETE FROM knowledge.source_versions
             WHERE id = $1`,
          [versionId],
        );
      }),
    ).rejects.toMatchObject({
      code: '42501',
    });

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const result = await tx.query<{
        source_id: string;
        storage_key: string;
        content_sha256: string;
        version_number: number;
      }>(
        `SELECT
             source_id,
             storage_key,
             content_sha256,
             version_number
           FROM knowledge.source_versions
           WHERE id = $1`,
        [versionId],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.source_id).toBe(sourceId);
      expect(result.rows[0]?.version_number).toBe(1);
      expect(result.rows[0]?.content_sha256).toBe(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
    });
  });

  it('grants the runtime role exactly the intended Firm Knowledge table privileges', async () => {
    const result = await database.withAdmin((client) =>
      client.query<{
        table_name: string;
        privilege_type: string;
      }>(
        `SELECT
           table_name,
           privilege_type
         FROM information_schema.role_table_grants
         WHERE grantee = 'legalintel_app'
           AND table_schema = 'knowledge'
           AND table_name IN ('sources', 'source_versions')
         ORDER BY table_name, privilege_type`,
      ),
    );

    const privileges = result.rows.map((row) => `${row.table_name}:${row.privilege_type}`);

    expect(privileges).toEqual([
      'source_versions:INSERT',
      'source_versions:SELECT',
      'sources:INSERT',
      'sources:SELECT',
      'sources:UPDATE',
    ]);
  });

  it('has no foreign-key dependency from Firm Knowledge into the public corpus', async () => {
    const result = await database.withAdmin((client) =>
      client.query<{
        source_table: string;
        target_schema: string;
        target_table: string;
      }>(
        `SELECT
           source.relname AS source_table,
           target_namespace.nspname AS target_schema,
           target.relname AS target_table
         FROM pg_constraint constraint_row
         JOIN pg_class source
           ON source.oid = constraint_row.conrelid
         JOIN pg_namespace source_namespace
           ON source_namespace.oid = source.relnamespace
         JOIN pg_class target
           ON target.oid = constraint_row.confrelid
         JOIN pg_namespace target_namespace
           ON target_namespace.oid = target.relnamespace
         WHERE constraint_row.contype = 'f'
           AND source_namespace.nspname = 'knowledge'
           AND source.relname IN ('sources', 'source_versions')`,
      ),
    );

    expect(result.rows.filter((row) => row.target_schema === 'corpus')).toEqual([]);
  });
});
