import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DB_ROLES,
  RUNTIME_ROLES,
  assertRuntimeRoleIsConstrained,
  bootstrapRoles,
  devRolePasswords,
} from '../src';
import { adminConnectionString, createTestDatabase, type TestDatabase } from '../src/testing';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.dispose();
});

interface RoleRow {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolconfig: string[] | null;
}

async function loadRoles(): Promise<Map<string, RoleRow>> {
  return database.withAdmin(async (client) => {
    const result = await client.query<RoleRow>(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
              rolbypassrls, rolconfig
         FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [Object.values(DB_ROLES)],
    );
    return new Map(result.rows.map((row) => [row.rolname, row]));
  });
}

describe('role bootstrap', () => {
  it('is idempotent and leaves every role unprivileged', async () => {
    const admin = new pg.Client({ connectionString: adminConnectionString() });
    await admin.connect();
    try {
      await bootstrapRoles(admin, devRolePasswords());
      await bootstrapRoles(admin, devRolePasswords());
    } finally {
      await admin.end();
    }

    const roles = await loadRoles();
    expect([...roles.keys()].sort()).toEqual(Object.values(DB_ROLES).sort());
    for (const role of roles.values()) {
      expect(role.rolcanlogin, role.rolname).toBe(true);
      expect(role.rolsuper, `${role.rolname} superuser`).toBe(false);
      expect(role.rolcreatedb, `${role.rolname} createdb`).toBe(false);
      expect(role.rolcreaterole, `${role.rolname} createrole`).toBe(false);
      expect(role.rolreplication, `${role.rolname} replication`).toBe(false);
      expect(role.rolbypassrls, `${role.rolname} bypassrls`).toBe(false);
    }
  });

  it('gives runtime roles statement, lock and idle-transaction timeouts, but not the migrator', async () => {
    const roles = await loadRoles();
    for (const key of RUNTIME_ROLES) {
      const config = roles.get(DB_ROLES[key])?.rolconfig ?? [];
      expect(config, DB_ROLES[key]).toEqual(
        expect.arrayContaining([
          'statement_timeout=30s',
          'idle_in_transaction_session_timeout=60s',
          'lock_timeout=10s',
        ]),
      );
    }
    // Migrations legitimately run long.
    expect(roles.get(DB_ROLES.migrator)?.rolconfig ?? []).toEqual([]);
  });

  it('applies those timeouts to real sessions', async () => {
    const pool = database.poolFor('app');
    const result = await pool.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(result.rows[0]?.statement_timeout).toBe('30s');
  });
});

describe('database hardening', () => {
  it('stops unrelated roles in the cluster from connecting', async () => {
    const stranger = `lip_probe_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: adminConnectionString() });
    await admin.connect();
    try {
      await admin.query(`CREATE ROLE ${stranger} LOGIN PASSWORD 'stranger'`);
      const url = new URL(database.adminUrl);
      url.username = stranger;
      url.password = 'stranger';

      const client = new pg.Client({ connectionString: url.toString() });
      await expect(client.connect()).rejects.toThrow(/permission denied for database/i);
      await client.end().catch(() => undefined);
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${stranger}`);
      await admin.end();
    }
  });

  it('denies the application role the ability to create schemas or tables', async () => {
    const pool = database.poolFor('app');
    await expect(pool.query('CREATE SCHEMA evil')).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query('CREATE TABLE public.evil (id int)')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('denies the application role access to operational metadata', async () => {
    const pool = database.poolFor('app');
    await expect(pool.query('SELECT * FROM ops.schema_migrations')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('assertRuntimeRoleIsConstrained', () => {
  it.each(RUNTIME_ROLES)('accepts the %s runtime role', async (role) => {
    await expect(assertRuntimeRoleIsConstrained(database.poolFor(role))).resolves.toBeUndefined();
  });

  it('rejects a superuser connection, which would silently disable row-level security', async () => {
    const pool = new pg.Pool({ connectionString: database.adminUrl, max: 1 });
    try {
      await expect(assertRuntimeRoleIsConstrained(pool)).rejects.toMatchObject({
        code: 'db.runtime_role_unsafe',
        message: expect.stringContaining('superuser') as unknown,
      });
    } finally {
      await pool.end();
    }
  });

  it('rejects the migrator, which owns the schema and must never serve requests', async () => {
    const pool = database.poolFor('migrator');
    await expect(assertRuntimeRoleIsConstrained(pool)).rejects.toMatchObject({
      code: 'db.runtime_role_unsafe',
      message: expect.stringContaining('owns tables or views') as unknown,
    });
  });
});
