import { performance } from 'node:perf_hooks';

import { AppError, internalError } from '@legalintel/kernel';
import type { Client } from 'pg';

import { loadMigrationSet, type MigrationFile, type MigrationSet } from './files';

/** Serialises concurrent deploys so two pipelines can never apply migrations at once. */
export const MIGRATION_LOCK_KEY = 7_331_001;

export interface MigrationEvent {
  readonly type: 'applied' | 'already_applied';
  readonly set: string;
  readonly version: number;
  readonly name: string;
  readonly durationMs?: number;
}

export interface RunOptions {
  readonly sets: readonly MigrationSet[];
  /** Roles that must exist before any migration runs (they are granted privileges by migrations). */
  readonly requiredRoles?: readonly string[];
  readonly onEvent?: (event: MigrationEvent) => void;
  /** How long to wait for another deploy holding the migration lock. */
  readonly lockWaitMs?: number;
  /** `lock_timeout` inside each migration, so DDL never queues indefinitely behind live traffic. */
  readonly ddlLockTimeoutMs?: number;
}

export interface MigrationReport {
  readonly applied: readonly MigrationEvent[];
  readonly alreadyApplied: number;
}

interface AppliedRow {
  readonly migration_set: string;
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

const ENSURE_TRACKING_TABLE = `
  CREATE SCHEMA IF NOT EXISTS ops;
  CREATE TABLE IF NOT EXISTS ops.schema_migrations (
    migration_set text        NOT NULL,
    version       integer     NOT NULL,
    name          text        NOT NULL,
    checksum      text        NOT NULL,
    applied_at    timestamptz NOT NULL DEFAULT now(),
    applied_by    text        NOT NULL DEFAULT current_user,
    execution_ms  integer     NOT NULL,
    PRIMARY KEY (migration_set, version)
  );`;

async function readApplied(client: Client): Promise<AppliedRow[]> {
  const exists = await client.query<{ present: boolean }>(
    `SELECT to_regclass('ops.schema_migrations') IS NOT NULL AS present`,
  );
  if (exists.rows[0]?.present !== true) return [];
  const result = await client.query<AppliedRow>(
    'SELECT migration_set, version, name, checksum FROM ops.schema_migrations',
  );
  return result.rows;
}

/**
 * Verifies that history on disk still matches history in the database. Editing an applied
 * migration, deleting one, or inserting one *behind* the deployed version each mean the
 * schema in some environment no longer matches the schema in the repository.
 */
export function verifyHistory(
  filesBySet: ReadonlyMap<string, readonly MigrationFile[]>,
  applied: readonly AppliedRow[],
): void {
  for (const row of applied) {
    const files = filesBySet.get(row.migration_set);
    if (files === undefined) continue; // A set this run was not asked about.

    const file = files.find((candidate) => candidate.version === row.version);
    if (file === undefined) {
      throw new AppError(
        'precondition_failed',
        'migration.missing_file',
        `Migration ${row.migration_set}/${row.version} (${row.name}) was applied to this database but no longer exists in the repository.`,
      );
    }
    if (file.checksum !== row.checksum) {
      throw new AppError(
        'precondition_failed',
        'migration.checksum_mismatch',
        `Migration ${row.migration_set}/${file.filename} was modified after it was applied. ` +
          'Applied migrations are immutable; add a new migration instead.',
      );
    }
  }

  for (const [setName, files] of filesBySet) {
    const appliedVersions = new Set(
      applied.filter((row) => row.migration_set === setName).map((row) => row.version),
    );
    const highest = Math.max(0, ...appliedVersions);
    for (const file of files) {
      if (!appliedVersions.has(file.version) && file.version < highest) {
        throw new AppError(
          'precondition_failed',
          'migration.out_of_order',
          `Migration ${setName}/${file.filename} has a version lower than one already applied (${highest}). ` +
            'Renumber it so it sorts after the latest applied migration.',
        );
      }
    }
  }
}

async function assertRolesExist(client: Client, roles: readonly string[]): Promise<void> {
  if (roles.length === 0) return;
  const result = await client.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
    [[...roles]],
  );
  const present = new Set(result.rows.map((row) => row.rolname));
  const missing = roles.filter((role) => !present.has(role));
  if (missing.length > 0) {
    throw new AppError(
      'precondition_failed',
      'migration.roles_missing',
      `Database roles do not exist: ${missing.join(', ')}. Run the role bootstrap first (pnpm --filter @legalintel/db db:bootstrap).`,
    );
  }
}

async function loadAll(sets: readonly MigrationSet[]): Promise<Map<string, MigrationFile[]>> {
  const result = new Map<string, MigrationFile[]>();
  for (const set of sets) {
    if (result.has(set.name)) {
      throw internalError('migration.duplicate_set', `Migration set "${set.name}" listed twice.`);
    }
    result.set(set.name, await loadMigrationSet(set));
  }
  return result;
}

async function applyOne(
  client: Client,
  file: MigrationFile,
  ddlLockTimeoutMs: number,
): Promise<number> {
  const started = performance.now();
  const record = `INSERT INTO ops.schema_migrations (migration_set, version, name, checksum, execution_ms)
                  VALUES ($1, $2, $3, $4, $5)`;
  const timeout = Math.trunc(ddlLockTimeoutMs);

  try {
    if (file.transactional) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = ${timeout}`);
      await client.query(file.sql);
    } else {
      // Session-level for the duration of this one statement batch; reset below.
      await client.query(`SET lock_timeout = ${timeout}`);
      await client.query(file.sql);
    }
    const elapsed = Math.round(performance.now() - started);
    await client.query(record, [file.set, file.version, file.name, file.checksum, elapsed]);
    if (file.transactional) await client.query('COMMIT');
    return elapsed;
  } catch (error) {
    if (file.transactional) await client.query('ROLLBACK').catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(
      'internal',
      'migration.failed',
      `Migration ${file.set}/${file.filename} failed and was rolled back: ${reason}`,
      { cause: error },
    );
  } finally {
    if (!file.transactional) await client.query('RESET lock_timeout').catch(() => undefined);
  }
}

/**
 * Applies pending migrations from each set, in the order the sets are listed. Sets are
 * listed dependencies-first (platform before legal). Uses one dedicated connection because
 * the advisory lock is session-scoped.
 */
export async function runMigrations(client: Client, options: RunOptions): Promise<MigrationReport> {
  const filesBySet = await loadAll(options.sets);
  const applied: MigrationEvent[] = [];
  let alreadyApplied = 0;

  const lockWait = Math.trunc(options.lockWaitMs ?? 60_000);
  await client.query(`SET lock_timeout = ${lockWait}`);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  } catch (error) {
    throw new AppError(
      'unavailable',
      'migration.lock_timeout',
      'Another migration run holds the lock. Try again when it has finished.',
      { cause: error },
    );
  } finally {
    await client.query('RESET lock_timeout');
  }

  try {
    await client.query(ENSURE_TRACKING_TABLE);
    await assertRolesExist(client, options.requiredRoles ?? []);

    const history = await readApplied(client);
    verifyHistory(filesBySet, history);
    const appliedKeys = new Set(history.map((row) => `${row.migration_set}:${row.version}`));

    for (const set of options.sets) {
      for (const file of filesBySet.get(set.name) ?? []) {
        if (appliedKeys.has(`${file.set}:${file.version}`)) {
          alreadyApplied += 1;
          options.onEvent?.({
            type: 'already_applied',
            set: file.set,
            version: file.version,
            name: file.name,
          });
          continue;
        }
        const durationMs = await applyOne(client, file, options.ddlLockTimeoutMs ?? 10_000);
        const event: MigrationEvent = {
          type: 'applied',
          set: file.set,
          version: file.version,
          name: file.name,
          durationMs,
        };
        applied.push(event);
        options.onEvent?.(event);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }

  return { applied, alreadyApplied };
}

export type MigrationState = 'applied' | 'pending' | 'checksum_mismatch' | 'missing_file';

export interface MigrationStatusRow {
  readonly set: string;
  readonly version: number;
  readonly name: string;
  readonly state: MigrationState;
}

/** Read-only report. Does not take the lock and never modifies the database. */
export async function getMigrationStatus(
  client: Client,
  sets: readonly MigrationSet[],
): Promise<MigrationStatusRow[]> {
  const filesBySet = await loadAll(sets);
  const history = await readApplied(client);
  const rows: MigrationStatusRow[] = [];

  for (const [setName, files] of filesBySet) {
    for (const file of files) {
      const row = history.find((r) => r.migration_set === setName && r.version === file.version);
      let state: MigrationState = 'pending';
      if (row !== undefined)
        state = row.checksum === file.checksum ? 'applied' : 'checksum_mismatch';
      rows.push({ set: setName, version: file.version, name: file.name, state });
    }
    for (const row of history) {
      if (row.migration_set === setName && !files.some((f) => f.version === row.version)) {
        rows.push({ set: setName, version: row.version, name: row.name, state: 'missing_file' });
      }
    }
  }
  return rows;
}
