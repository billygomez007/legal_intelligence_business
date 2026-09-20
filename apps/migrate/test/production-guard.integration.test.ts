import { APP_ENVIRONMENTS } from '@legalintel/config';
import { runMigrationCli } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { KNOWN_ENVIRONMENTS } from '@legalintel/legal-corpus';
import { seedSyntheticCorpus } from '@legalintel/legal-corpus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertProductionSafety } from '../src/guards';
import { allMigrationSets } from '../src/sets';

/**
 * Fabricated authority must never reach a user. The migration CLI is the one production entry
 * point that exists today, so a production deploy must fail if synthetic fixtures are present.
 */
let clean: TestDatabase;
let seeded: TestDatabase;

async function staffIds(database: TestDatabase) {
  const ids: string[] = [];
  for (const label of ['rights', 'reviewer', 'publisher']) {
    const result = await database.withAdmin((c) =>
      c.query<{ id: string }>(`INSERT INTO iam.users (email) VALUES ($1) RETURNING id`, [
        `${label}@guard.example.test`,
      ]),
    );
    ids.push(result.rows[0]?.id ?? '');
  }
  return { rightsOfficer: ids[0] ?? '', reviewer: ids[1] ?? '', publisher: ids[2] ?? '' };
}

beforeAll(async () => {
  [clean, seeded] = await Promise.all([
    createTestDatabase({ migrationSets: allMigrationSets }),
    createTestDatabase({ migrationSets: allMigrationSets }),
  ]);
  await seedSyntheticCorpus(
    { ingest: seeded.poolFor('ingest'), dataops: seeded.poolFor('dataops') },
    await staffIds(seeded),
    { documentCount: 1 },
  );
});

afterAll(async () => {
  await Promise.all([clean.dispose(), seeded.dispose()]);
});

describe('assertProductionSafety', () => {
  it('passes in production on a database with no fixtures', async () => {
    await expect(
      assertProductionSafety(clean.urlFor('migrator'), 'production'),
    ).resolves.toBeUndefined();
  });

  it('refuses a production database that contains synthetic fixtures', async () => {
    await expect(
      assertProductionSafety(seeded.urlFor('migrator'), 'production'),
    ).rejects.toMatchObject({
      code: 'corpus.synthetic_in_production',
    });
  });

  it.each(['development', 'test', 'staging'])(
    'does not object to fixtures outside production (%s)',
    async (env) => {
      await expect(assertProductionSafety(seeded.urlFor('migrator'), env)).resolves.toBeUndefined();
    },
  );

  // An unrecognised value must never read as "not production": that is exactly how a mistyped
  // or forgotten environment would switch the synthetic-data check off.
  it.each(['', '   ', 'prod', 'Production', 'PRODUCTION', 'live', 'production '])(
    'fails closed for an unrecognised environment (%j), even on a database with fixtures',
    async (env) => {
      await expect(assertProductionSafety(seeded.urlFor('migrator'), env)).rejects.toThrow(
        /APP_ENV/,
      );
      await expect(assertProductionSafety(clean.urlFor('migrator'), env)).rejects.toThrow(
        /APP_ENV/,
      );
    },
  );
});

describe('the corpus guard and the configuration agree on what an environment is', () => {
  it('accept exactly the same names', () => {
    expect([...KNOWN_ENVIRONMENTS]).toEqual([...APP_ENVIRONMENTS]);
  });
});

describe('the migration CLI applies the after-command hook', () => {
  const saved = { url: process.env['MIGRATOR_DATABASE_URL'], exitCode: process.exitCode };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.url === undefined) delete process.env['MIGRATOR_DATABASE_URL'];
    else process.env['MIGRATOR_DATABASE_URL'] = saved.url;
    process.exitCode = saved.exitCode;
  });

  const useDatabase = (database: TestDatabase) => {
    process.env['MIGRATOR_DATABASE_URL'] = database.urlFor('migrator');
  };

  it('runs the hook after migrate, status and setup-style commands, with the migrator URL', async () => {
    useDatabase(clean);
    const hook = vi.fn(() => Promise.resolve());
    await runMigrationCli(allMigrationSets, ['migrate'], { afterCommand: hook });
    await runMigrationCli(allMigrationSets, ['status'], { afterCommand: hook });

    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook).toHaveBeenCalledWith({
      command: 'migrate',
      migratorUrl: clean.urlFor('migrator'),
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('does not run the hook for other commands or for bad usage', async () => {
    useDatabase(clean);
    const hook = vi.fn(() => Promise.resolve());
    await runMigrationCli(allMigrationSets, ['nonsense'], { afterCommand: hook });
    expect(hook).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('fails the command when the hook throws', async () => {
    useDatabase(clean);
    await runMigrationCli(allMigrationSets, ['migrate'], {
      afterCommand: () => Promise.reject(new Error('production safety check failed')),
    });
    expect(process.exitCode).toBe(1);
  });

  it('END TO END: a production deploy against a database with fixtures exits non-zero', async () => {
    useDatabase(seeded);
    await runMigrationCli(allMigrationSets, ['migrate'], {
      afterCommand: ({ migratorUrl }) => assertProductionSafety(migratorUrl, 'production'),
    });
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('synthetic');
  });

  it('END TO END: the same deploy against a clean database succeeds', async () => {
    useDatabase(clean);
    await runMigrationCli(allMigrationSets, ['migrate'], {
      afterCommand: ({ migratorUrl }) => assertProductionSafety(migratorUrl, 'production'),
    });
    expect(process.exitCode).toBeUndefined();
  });
});
