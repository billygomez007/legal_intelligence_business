import { createHash, randomBytes } from 'node:crypto';

import pg from 'pg';

import { loadMigrationSet, type MigrationSet } from '../migrate/files';
import { runMigrations } from '../migrate/runner';
import { REQUIRED_ROLES, platformMigrations } from '../migrate/sets';
import {
  DB_ROLES,
  DEV_ROLE_PASSWORD,
  PROVISIONING_LOCK_KEY,
  bootstrapRoles,
  devRolePasswords,
  hardenDatabase,
  type DbRole,
} from '../roles';

/**
 * Real PostgreSQL for integration tests. Tenant isolation and rights enforcement are
 * properties of the database; a mock would test our assumptions about it, not the database.
 *
 * Each test file gets its own database, cloned from a template that already has all
 * migrations applied, so a file costs milliseconds instead of a full migration run and
 * files cannot interfere with each other. Templates are keyed by a fingerprint of the
 * migration contents, so changing a migration produces a fresh template automatically.
 */

const DEFAULT_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54320/postgres';
const TEMPLATE_PREFIX = 'lip_tpl_';
const TEST_DB_PREFIX = 'lip_test_';
const READY_MARKER = 'ready';
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function adminConnectionString(): string {
  return process.env['TEST_DATABASE_ADMIN_URL'] ?? DEFAULT_ADMIN_URL;
}

function urlFor(databaseName: string, role: DbRole): string {
  const url = new URL(adminConnectionString());
  url.username = DB_ROLES[role];
  url.password = DEV_ROLE_PASSWORD;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function adminUrlFor(databaseName: string): string {
  const url = new URL(adminConnectionString());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

/**
 * Admin sessions used to provision test databases are bounded: if something holds a lock we
 * need (a leaked connection, a crashed run), we fail in seconds with a clear message instead of
 * stalling a test run, or CI, indefinitely.
 */
async function connectAdmin(): Promise<pg.Client> {
  const client = await connect(adminConnectionString());
  await client.query("SET lock_timeout = '45s'");
  await client.query("SET statement_timeout = '120s'");
  return client;
}

export interface TestDatabase {
  readonly name: string;
  /** Superuser connection string for this database. Bypasses RLS; for arranging fixtures only. */
  readonly adminUrl: string;
  urlFor(role: DbRole): string;
  /** A pooled connection as the given role (default pool size 5). Closed on dispose. */
  poolFor(role: DbRole, options?: { max?: number }): pg.Pool;
  /** Runs `fn` on a superuser connection to this database, for arranging fixtures and probing the catalog. */
  withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T>;
  /** Runs `fn` as the migrator role (the owner of migrated objects). */
  withMigrator<T>(fn: (client: pg.Client) => Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}

function wrap(name: string): TestDatabase {
  const pools: pg.Pool[] = [];
  return {
    name,
    adminUrl: adminUrlFor(name),
    urlFor: (role) => urlFor(name, role),
    poolFor(role, options) {
      const pool = new pg.Pool({
        connectionString: urlFor(name, role),
        max: options?.max ?? 5,
        application_name: `test-${role}`,
      });
      // A dropped test connection during teardown is expected noise, not a failure.
      pool.on('error', () => undefined);
      pools.push(pool);
      return pool;
    },
    async withAdmin(fn) {
      const client = await connect(adminUrlFor(name));
      try {
        return await fn(client);
      } finally {
        await client.end();
      }
    },
    async withMigrator(fn) {
      const client = await connect(urlFor(name, 'migrator'));
      try {
        return await fn(client);
      } finally {
        await client.end();
      }
    },
    async dispose() {
      await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
      const admin = await connectAdmin();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}

async function fingerprint(sets: readonly MigrationSet[]): Promise<string> {
  const hash = createHash('sha256');
  for (const set of sets) {
    hash.update(`set:${set.name}\n`);
    for (const file of await loadMigrationSet(set)) {
      hash.update(`${file.version}:${file.checksum}\n`);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

async function dropStaleTestDatabases(admin: pg.Client): Promise<void> {
  const result = await admin.query<{ datname: string }>(
    'SELECT datname FROM pg_database WHERE datname LIKE $1',
    [`${TEST_DB_PREFIX}%`],
  );
  const now = Date.now();
  for (const { datname } of result.rows) {
    const created = Number.parseInt(/^lip_test_(\d+)_/.exec(datname)?.[1] ?? '', 10);
    if (Number.isFinite(created) && now - created > STALE_AFTER_MS) {
      await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(datname)} WITH (FORCE)`);
    }
  }
}

async function ensureTemplate(admin: pg.Client, sets: readonly MigrationSet[]): Promise<string> {
  const name = `${TEMPLATE_PREFIX}${await fingerprint(sets)}`;
  const state = await admin.query<{ marker: string | null }>(
    `SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1`,
    [name],
  );

  if (state.rows[0]?.marker === READY_MARKER) return name;
  if (state.rows.length > 0) {
    // A previous run died mid-migration. An unmarked template is unusable.
    await admin.query(`DROP DATABASE ${admin.escapeIdentifier(name)} WITH (FORCE)`);
  }

  await admin.query(
    `CREATE DATABASE ${admin.escapeIdentifier(name)} OWNER ${admin.escapeIdentifier(DB_ROLES.migrator)}`,
  );
  await hardenDatabase(admin, name);

  const migrator = await connect(urlFor(name, 'migrator'));
  try {
    await runMigrations(migrator, { sets, requiredRoles: REQUIRED_ROLES });
  } finally {
    await migrator.end();
  }

  await admin.query(`COMMENT ON DATABASE ${admin.escapeIdentifier(name)} IS '${READY_MARKER}'`);
  return name;
}

export interface CreateTestDatabaseOptions {
  /** Migration sets to apply, dependencies first. Defaults to the platform set. */
  readonly migrationSets?: readonly MigrationSet[];
}

/** A fresh, isolated, fully migrated database. Call `dispose()` in `afterAll`. */
export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const sets = options.migrationSets ?? [platformMigrations];
  const admin = await connectAdmin();
  const name = `${TEST_DB_PREFIX}${Date.now()}_${randomBytes(4).toString('hex')}`;

  try {
    // One lock covers role creation, template creation and cloning: CREATE DATABASE ...
    // TEMPLATE fails if anyone else is connected to the template at that moment.
    await admin.query('SELECT pg_advisory_lock($1)', [PROVISIONING_LOCK_KEY]);
    try {
      await bootstrapRoles(admin, devRolePasswords());
      await dropStaleTestDatabases(admin);
      const template = await ensureTemplate(admin, sets);
      await admin.query(
        `CREATE DATABASE ${admin.escapeIdentifier(name)} TEMPLATE ${admin.escapeIdentifier(template)} OWNER ${admin.escapeIdentifier(DB_ROLES.migrator)}`,
      );
      await hardenDatabase(admin, name);
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [PROVISIONING_LOCK_KEY]);
    }
  } finally {
    await admin.end();
  }

  return wrap(name);
}

/** An empty database with roles but no migrations. For testing the migration runner itself. */
export async function createEmptyTestDatabase(): Promise<TestDatabase> {
  const admin = await connectAdmin();
  const name = `${TEST_DB_PREFIX}${Date.now()}_${randomBytes(4).toString('hex')}`;
  try {
    await admin.query('SELECT pg_advisory_lock($1)', [PROVISIONING_LOCK_KEY]);
    try {
      await bootstrapRoles(admin, devRolePasswords());
      await dropStaleTestDatabases(admin);
      await admin.query(
        `CREATE DATABASE ${admin.escapeIdentifier(name)} OWNER ${admin.escapeIdentifier(DB_ROLES.migrator)}`,
      );
      await hardenDatabase(admin, name);
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [PROVISIONING_LOCK_KEY]);
    }
  } finally {
    await admin.end();
  }
  return wrap(name);
}
