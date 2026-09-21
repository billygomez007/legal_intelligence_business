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

describe('Firm Knowledge concurrent version allocation diagnostic', () => {
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

  it('preserves unique committed version numbers when two allocations race', async () => {
    // Arrange a source using the repository-native transaction harness.
    const source = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      async (tx) =>
        pgKnowledgeStore.createSource(tx, {
          id: KnowledgeSourceId.parse(randomUUID()),
          name: 'Firm Litigation Manual',
          description: 'Approved internal litigation guidance.',
        }),
    );

    let waiting = 0;
    let releaseBarrier: (() => void) | undefined;

    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const race = async (suffix: string) =>
      withTenantTransaction(pool, { organizationId: organizationA }, async (tx) => {
        waiting += 1;

        if (waiting === 2) {
          releaseBarrier?.();
        }

        await barrier;

        const base = {
          id: KnowledgeSourceVersionId.parse(randomUUID()),
          sourceId: source.id,
          originalFilename: 'employment-note-v1.pdf',
          mimeType: 'application/pdf',
          storageKey: `firm/${organizationA}/${randomUUID()}.pdf`,
          contentSha256: 'a'.repeat(64),
          sizeBytes: 1024,
        };

        return pgKnowledgeStore.createSourceVersion(tx, {
          ...base,
          sourceId: source.id,
          originalFilename: `${suffix}-${base.originalFilename}`,
          storageKey: `${base.storageKey}-${suffix}`,
          contentSha256:
            suffix === 'a'
              ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
              : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
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
      'CONCURRENCY_OUTCOME=' +
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

    const committed = await withTenantTransaction(pool, { organizationId: organizationA }, (tx) =>
      pgKnowledgeStore.listSourceVersions(tx, source.id),
    );

    const committedNumbers = committed.map((version) => version.versionNumber);

    console.log('COMMITTED_VERSION_NUMBERS=' + JSON.stringify(committedNumbers));

    expect(new Set(committedNumbers).size).toBe(committedNumbers.length);

    expect(committed.length).toBe(fulfilled.length);

    expect([...successfulNumbers].sort((left, right) => left - right)).toEqual([1, 2]);

    console.log('CONCURRENCY_CLASSIFICATION=SERIALIZED_PER_SOURCE');
  });
});
