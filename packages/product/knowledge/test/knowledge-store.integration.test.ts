import { randomUUID } from 'node:crypto';

import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgKnowledgeStore } from '../src/adapters/pg-knowledge-store';
import { KnowledgeSourceId } from '../src/domain/source';
import { KnowledgeSourceVersionId } from '../src/domain/source-version';
import { knowledgeMigrations } from '../src/migrations';

type TenantScope = Parameters<typeof withTenantTransaction>[1];
type OrganizationId = TenantScope['organizationId'];

describe('Firm Knowledge PostgreSQL store', () => {
  const pgKnowledgeStore = new PgKnowledgeStore();
  let database!: TestDatabase;
  let pool!: DbPool;

  const organizationA = randomUUID() as OrganizationId;
  const organizationB = randomUUID() as OrganizationId;

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, knowledgeMigrations],
    });

    pool = database.poolFor('app', { max: 8 });

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
          organizationA,
          'Phase 4B Firm A',
          `phase4b-store-a-${organizationA}`,
          organizationB,
          'Phase 4B Firm B',
          `phase4b-store-b-${organizationB}`,
        ],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('creates, reads, lists, updates and archives an organization source', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const created = await pgKnowledgeStore.createSource(tx, {
        id: KnowledgeSourceId.parse(randomUUID()),
        name: 'Firm Litigation Manual',
        description: 'Approved internal litigation guidance.',
      });

      expect(created.organizationId).toBe(organizationA);
      expect(created.name).toBe('Firm Litigation Manual');
      expect(created.description).toBe('Approved internal litigation guidance.');
      expect(created.status).toBe('active');

      const found = await pgKnowledgeStore.findSource(tx, created.id);

      expect(found?.id).toBe(created.id);

      const active = await pgKnowledgeStore.listSources(tx, 'active');

      expect(active.some((source) => source.id === created.id)).toBe(true);

      const updated = await pgKnowledgeStore.updateSource(tx, {
        id: created.id,
        name: 'Firm Litigation Handbook',
        description: 'Updated approved internal guidance.',
      });

      expect(updated?.name).toBe('Firm Litigation Handbook');
      expect(updated?.description).toBe('Updated approved internal guidance.');

      const archived = await pgKnowledgeStore.setSourceStatus(tx, created.id, 'archived');

      expect(archived?.status).toBe('archived');

      const archivedSources = await pgKnowledgeStore.listSources(tx, 'archived');

      expect(archivedSources.some((source) => source.id === created.id)).toBe(true);
    });
  });

  it('does not expose another organization source', async () => {
    let sourceId!: KnowledgeSourceId;

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const created = await pgKnowledgeStore.createSource(tx, {
        id: KnowledgeSourceId.parse(randomUUID()),
        name: 'Firm A Private Precedent',
      });

      sourceId = created.id;
    });

    await withTenantTransaction(pool, { organizationId: organizationB }, async (tx) => {
      expect(await pgKnowledgeStore.findSource(tx, sourceId)).toBeNull();

      const sources = await pgKnowledgeStore.listSources(tx);

      expect(sources.some((source) => source.id === sourceId)).toBe(false);
    });
  });

  it('creates immutable source versions and numbers them in order', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const source = await pgKnowledgeStore.createSource(tx, {
        id: KnowledgeSourceId.parse(randomUUID()),
        name: 'Employment Practice Note',
      });

      const first = await pgKnowledgeStore.createSourceVersion(tx, {
        id: KnowledgeSourceVersionId.parse(randomUUID()),
        sourceId: source.id,
        originalFilename: 'employment-note-v1.pdf',
        mimeType: 'application/pdf',
        storageKey: `firm/${organizationA}/${randomUUID()}.pdf`,
        contentSha256: 'a'.repeat(64),
        sizeBytes: 1024,
      });

      const second = await pgKnowledgeStore.createSourceVersion(tx, {
        id: KnowledgeSourceVersionId.parse(randomUUID()),
        sourceId: source.id,
        originalFilename: 'employment-note-v2.pdf',
        mimeType: 'application/pdf',
        storageKey: `firm/${organizationA}/${randomUUID()}.pdf`,
        contentSha256: 'b'.repeat(64),
        sizeBytes: 2048,
      });

      expect(first.versionNumber).toBe(1);
      expect(second.versionNumber).toBe(2);

      const versions = await pgKnowledgeStore.listSourceVersions(tx, source.id);

      expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);

      expect(versions[0]?.sourceId).toBe(source.id);
      expect(versions[1]?.sourceId).toBe(source.id);
    });
  });

  it('cannot create a version against another organization source', async () => {
    let foreignSourceId!: KnowledgeSourceId;

    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      foreignSourceId = (
        await pgKnowledgeStore.createSource(tx, {
          id: KnowledgeSourceId.parse(randomUUID()),
          name: 'Firm A Secret Knowledge',
        })
      ).id;
    });

    await expect(
      withTenantTransaction(pool, { organizationId: organizationB }, (tx) =>
        pgKnowledgeStore.createSourceVersion(tx, {
          id: KnowledgeSourceVersionId.parse(randomUUID()),
          sourceId: foreignSourceId,
          originalFilename: 'foreign.pdf',
          mimeType: 'application/pdf',
          storageKey: `firm/${organizationB}/${randomUUID()}.pdf`,
          contentSha256: 'c'.repeat(64),
          sizeBytes: 100,
        }),
      ),
    ).rejects.toThrow();
  });

  it('keeps versions available after their source is archived', async () => {
    await withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
      const source = await pgKnowledgeStore.createSource(tx, {
        id: KnowledgeSourceId.parse(randomUUID()),
        name: 'Archived Knowledge',
      });

      const version = await pgKnowledgeStore.createSourceVersion(tx, {
        id: KnowledgeSourceVersionId.parse(randomUUID()),
        sourceId: source.id,
        originalFilename: 'archived.pdf',
        mimeType: 'application/pdf',
        storageKey: `firm/${organizationA}/${randomUUID()}.pdf`,
        contentSha256: 'd'.repeat(64),
        sizeBytes: 512,
      });

      await pgKnowledgeStore.setSourceStatus(tx, source.id, 'archived');

      const versions = await pgKnowledgeStore.listSourceVersions(tx, source.id);

      expect(versions.some((candidate) => candidate.id === version.id)).toBe(true);
    });
  });
});
