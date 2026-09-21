import { randomUUID } from 'node:crypto';

import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { OrganizationId } from '@legalintel/kernel';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { pgWorkspaceStore, workspaceMigrations } from '@legalintel/workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgMatterDocumentStore } from '../src/adapters/pg-matter-document-store';
import { MatterDocumentId } from '../src/domain/document';
import { MatterDocumentVersionId } from '../src/domain/document-version';
import { matterDocumentMigrations } from '../src/migrations';

describe('Matter Documents concurrent version allocation', () => {
  const store = new PgMatterDocumentStore();

  let database: TestDatabase;
  let pool: DbPool;

  const organizationId = OrganizationId.parse(randomUUID());
  const jurisdictionId = JurisdictionId.parse(randomUUID());

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [
        platformMigrations,
        iamMigrations,
        corpusMigrations,
        workspaceMigrations,
        matterDocumentMigrations,
      ],
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
         VALUES ($1, $2, $3, 'firm')`,
        [organizationId, 'Matter Documents Concurrency Firm', `mdc-${organizationId}`],
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
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('commits version numbers 1 and 2 when two independent transactions allocate concurrently', async () => {
    const fixture = await withTenantTransaction(pool, { organizationId }, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, {
        name: 'Concurrent Version Client',
        reference: 'MD-CONCURRENCY-CLIENT',
      });

      const matter = await pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId,
        name: 'Ghana Concurrent Version Matter',
        reference: 'MD-CONCURRENCY-MATTER',
      });

      const document = await store.createDocument(tx, {
        id: MatterDocumentId.parse(randomUUID()),
        matterId: matter.id,
        name: 'Concurrent Version Allocation Document',
        description: 'Tests serialized Matter Document version allocation.',
      });

      return {
        matterId: matter.id,
        documentId: document.id,
      };
    });

    let waiting = 0;
    let releaseBarrier: (() => void) | undefined;

    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const race = async (suffix: 'a' | 'b') =>
      withTenantTransaction(pool, { organizationId }, async (tx) => {
        waiting += 1;

        if (waiting === 2) {
          releaseBarrier?.();
        }

        await barrier;

        return store.createDocumentVersion(tx, {
          id: MatterDocumentVersionId.parse(randomUUID()),
          matterId: fixture.matterId,
          documentId: fixture.documentId,
          originalFilename: `concurrent-${suffix}.pdf`,
          mimeType: 'application/pdf',
          storageKey: `matter-documents/${organizationId}/${fixture.documentId}/${suffix}-${randomUUID()}.pdf`,
          contentSha256:
            suffix === 'a'
              ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
              : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sizeBytes: suffix === 'a' ? 1024 : 2048,
        });
      });

    const settled = await Promise.allSettled([race('a'), race('b')]);

    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof race>>> =>
        result.status === 'fulfilled',
    );

    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    console.log(
      'MATTER_DOCUMENT_CONCURRENCY_OUTCOME=' +
        JSON.stringify({
          fulfilled: fulfilled.length,
          rejected: rejected.length,
          successfulVersions: fulfilled.map((result) => result.value.versionNumber),
          rejectedReasons: rejected.map((result) =>
            result.reason instanceof Error
              ? {
                  name: result.reason.name,
                  message: result.reason.message,
                }
              : String(result.reason),
          ),
        }),
    );

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(0);

    const successfulNumbers = fulfilled.map((result) => result.value.versionNumber);

    expect(new Set(successfulNumbers).size).toBe(successfulNumbers.length);

    expect([...successfulNumbers].sort((left, right) => left - right)).toEqual([1, 2]);

    const committed = await withTenantTransaction(
      pool,
      { organizationId },
      (tx) => store.listDocumentVersions(tx, fixture.documentId),
      { readOnly: true },
    );

    const committedNumbers = committed.map((version) => version.versionNumber);

    console.log('MATTER_DOCUMENT_COMMITTED_VERSION_NUMBERS=' + JSON.stringify(committedNumbers));

    expect(committed).toHaveLength(2);

    expect(new Set(committedNumbers).size).toBe(committedNumbers.length);

    expect([...committedNumbers].sort((left, right) => left - right)).toEqual([1, 2]);

    expect([...successfulNumbers].sort((left, right) => left - right)).toEqual(
      [...committedNumbers].sort((left, right) => left - right),
    );

    console.log('MATTER_DOCUMENT_CONCURRENCY_CLASSIFICATION=SERIALIZED_PER_DOCUMENT');
  });
});
