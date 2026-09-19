import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATION_LOCK_KEY, getMigrationStatus, runMigrations, type MigrationSet } from '../src';
import { createEmptyTestDatabase, type TestDatabase } from '../src/testing';

let database: TestDatabase;
const directories: string[] = [];

beforeAll(async () => {
  database = await createEmptyTestDatabase();
});

afterAll(async () => {
  await database.dispose();
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeSet(name: string, files: Record<string, string>): Promise<MigrationSet> {
  const directory = await mkdtemp(path.join(tmpdir(), `lip-${name}-`));
  directories.push(directory);
  for (const [file, content] of Object.entries(files)) {
    await writeFile(path.join(directory, file), content);
  }
  return { name, directory };
}

async function overwrite(set: MigrationSet, file: string, content: string) {
  await writeFile(path.join(set.directory, file), content);
}

async function scalar<T>(sql: string): Promise<T | undefined> {
  return database.withAdmin(async (client) => {
    const result = await client.query<{ v: T }>(sql);
    return result.rows[0]?.v;
  });
}

describe('runMigrations', () => {
  afterEach(async () => {
    await database.withAdmin(async (client) => {
      await client.query('DROP SCHEMA IF EXISTS ops CASCADE');
      await client.query('DROP SCHEMA IF EXISTS t CASCADE');
    });
  });

  it('applies migrations in order and records version, checksum and applier', async () => {
    const set = await makeSet('order', {
      '0001_schema.sql': 'CREATE SCHEMA t;',
      '0002_table.sql': 'CREATE TABLE t.a (id int);',
    });

    const report = await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    expect(report.applied.map((event) => event.version)).toEqual([1, 2]);
    expect(report.alreadyApplied).toBe(0);

    const rows = await database.withAdmin(async (client) => {
      const result = await client.query<{
        version: number;
        checksum: string;
        applied_by: string;
      }>('SELECT version, checksum, applied_by FROM ops.schema_migrations ORDER BY version');
      return result.rows;
    });
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum))).toBe(true);
    expect(rows.every((row) => row.applied_by === 'legalintel_migrator')).toBe(true);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const set = await makeSet('idem', { '0001_schema.sql': 'CREATE SCHEMA t;' });
    await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    const second = await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    expect(second.applied).toHaveLength(0);
    expect(second.alreadyApplied).toBe(1);
  });

  it('refuses to run when an applied migration has been edited', async () => {
    const set = await makeSet('tamper', {
      '0001_schema.sql': 'CREATE SCHEMA t;',
      '0002_table.sql': 'CREATE TABLE t.a (id int);',
    });
    await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    await overwrite(set, '0002_table.sql', 'CREATE TABLE t.a (id int, sneaky text);');

    await expect(
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
    ).rejects.toMatchObject({ code: 'migration.checksum_mismatch' });
  });

  it('refuses to run when an applied migration has been deleted from the repository', async () => {
    const set = await makeSet('missing', {
      '0001_schema.sql': 'CREATE SCHEMA t;',
      '0002_table.sql': 'CREATE TABLE t.a (id int);',
    });
    await database.withMigrator((client) => runMigrations(client, { sets: [set] }));
    await rm(path.join(set.directory, '0002_table.sql'));

    await expect(
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
    ).rejects.toMatchObject({ code: 'migration.missing_file' });
  });

  it('refuses a new migration numbered below one already applied', async () => {
    const set = await makeSet('ooo', {
      '0001_schema.sql': 'CREATE SCHEMA t;',
      '0003_table.sql': 'CREATE TABLE t.c (id int);',
    });
    await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    await overwrite(set, '0002_late.sql', 'CREATE TABLE t.b (id int);');

    await expect(
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
    ).rejects.toMatchObject({ code: 'migration.out_of_order' });
  });

  it('rolls a failing migration back completely and records nothing for it', async () => {
    const set = await makeSet('rollback', {
      '0001_schema.sql': 'CREATE SCHEMA t;',
      '0002_broken.sql': 'CREATE TABLE t.half_done (id int);\nCREATE TABLE t.broken (id int, ;',
    });

    await expect(
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
    ).rejects.toMatchObject({ code: 'migration.failed' });

    expect(await scalar<string | null>(`SELECT to_regclass('t.half_done')::text AS v`)).toBeNull();
    expect(await scalar<string>('SELECT count(*)::text AS v FROM ops.schema_migrations')).toBe('1');

    // The failed migration was never applied, so it can be corrected in place.
    await overwrite(set, '0002_broken.sql', 'CREATE TABLE t.fixed (id int);');
    const retry = await database.withMigrator((client) => runMigrations(client, { sets: [set] }));
    expect(retry.applied.map((event) => event.version)).toEqual([2]);
  });

  it('runs no-transaction migrations, which PostgreSQL requires for CREATE INDEX CONCURRENTLY', async () => {
    const set = await makeSet('notx', {
      '0001_table.sql': 'CREATE SCHEMA t; CREATE TABLE t.a (id int);',
      '0002_index.sql':
        '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY a_id_idx ON t.a (id);',
    });

    await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    expect(
      await scalar<string>(`SELECT indexname AS v FROM pg_indexes WHERE indexname = 'a_id_idx'`),
    ).toBe('a_id_idx');
  });

  it('applies sets in the order given, so dependencies can come first', async () => {
    const base = await makeSet('base', { '0001_schema.sql': 'CREATE SCHEMA t;' });
    const dependent = await makeSet('dependent', {
      '0001_table.sql': 'CREATE TABLE t.uses_base (id int);',
    });

    const report = await database.withMigrator((client) =>
      runMigrations(client, { sets: [base, dependent] }),
    );

    expect(report.applied.map((event) => event.set)).toEqual(['base', 'dependent']);
  });

  it('serialises concurrent runs: each migration is applied exactly once and nothing errors', async () => {
    const set = await makeSet('race', {
      '0001_schema.sql': 'CREATE SCHEMA t;',
      '0002_slow.sql': 'SELECT pg_sleep(0.3); CREATE TABLE t.a (id int);',
      '0003_more.sql': 'CREATE TABLE t.b (id int);',
    });

    const runs = await Promise.all([
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
      database.withMigrator((client) => runMigrations(client, { sets: [set] })),
    ]);

    const totalApplied = runs.reduce((sum, run) => sum + run.applied.length, 0);
    expect(totalApplied).toBe(3);
    expect(await scalar<string>('SELECT count(*)::text AS v FROM ops.schema_migrations')).toBe('3');
  });

  it('gives up with a clear error if another deploy holds the lock', async () => {
    const set = await makeSet('locked', { '0001_schema.sql': 'CREATE SCHEMA t;' });

    await database.withMigrator(async (holder) => {
      await holder.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      try {
        await expect(
          database.withMigrator((client) =>
            runMigrations(client, { sets: [set], lockWaitMs: 300 }),
          ),
        ).rejects.toMatchObject({ code: 'migration.lock_timeout' });
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      }
    });
  });

  it('fails fast instead of queueing DDL behind a long-running transaction', async () => {
    const setup = await makeSet('ddl-setup', {
      '0001_table.sql': 'CREATE SCHEMA t; CREATE TABLE t.busy (id int);',
    });
    await database.withMigrator((client) => runMigrations(client, { sets: [setup] }));

    const alter = await makeSet('ddl-alter', {
      '0001_alter.sql': 'ALTER TABLE t.busy ADD COLUMN c int;',
    });

    await database.withMigrator(async (blocker) => {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE t.busy IN ACCESS EXCLUSIVE MODE');
      try {
        const started = Date.now();
        await expect(
          database.withMigrator((client) =>
            runMigrations(client, { sets: [alter], ddlLockTimeoutMs: 300 }),
          ),
        ).rejects.toThrow(/lock timeout/i);
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        await blocker.query('ROLLBACK');
      }
    });
  });

  it('refuses to start when required roles do not exist', async () => {
    const set = await makeSet('roles', { '0001_schema.sql': 'CREATE SCHEMA t;' });
    await expect(
      database.withMigrator((client) =>
        runMigrations(client, {
          sets: [set],
          requiredRoles: ['legalintel_app', 'no_such_role_xyz'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'migration.roles_missing' });
    // Nothing was applied.
    expect(await scalar<string | null>(`SELECT to_regnamespace('t')::text AS v`)).toBeNull();
  });
});

describe('getMigrationStatus', () => {
  afterEach(async () => {
    await database.withAdmin(async (client) => {
      await client.query('DROP SCHEMA IF EXISTS ops CASCADE');
      await client.query('DROP SCHEMA IF EXISTS s CASCADE');
    });
  });

  it('reports every state without modifying the database', async () => {
    const set = await makeSet('status', {
      '0001_a.sql': 'CREATE SCHEMA s;',
      '0002_b.sql': 'CREATE TABLE s.b (id int);',
    });
    await database.withMigrator((client) => runMigrations(client, { sets: [set] }));

    await overwrite(set, '0002_b.sql', 'CREATE TABLE s.b (id int, extra int);');
    await overwrite(set, '0003_c.sql', 'CREATE TABLE s.c (id int);');

    const status = await database.withMigrator((client) => getMigrationStatus(client, [set]));

    expect(status.map((row) => [row.version, row.state])).toEqual([
      [1, 'applied'],
      [2, 'checksum_mismatch'],
      [3, 'pending'],
    ]);
    expect(await scalar<string | null>(`SELECT to_regclass('s.c')::text AS v`)).toBeNull();
  });

  it('reports everything pending on a database that has never been migrated', async () => {
    const set = await makeSet('fresh', { '0001_a.sql': 'CREATE SCHEMA s;' });
    const status = await database.withMigrator((client) => getMigrationStatus(client, [set]));
    expect(status.map((row) => row.state)).toEqual(['pending']);
  });
});
