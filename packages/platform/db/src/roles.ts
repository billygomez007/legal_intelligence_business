import type { Client } from 'pg';

/**
 * Four database roles, each with a different blast radius. The application never connects as
 * the owner of its own tables, so a bug (or injection) in request handling cannot alter the
 * schema, and row-level security always applies to it.
 *
 *  - migrator: owns every object. Used only by the deploy pipeline. Never by a running service.
 *  - app:      end-user API. Row-level security applies. Sees only published, rights-cleared
 *              corpus content and only its own tenant's private data.
 *  - ingest:   ingestion workers. Writes draft corpus content. No access to tenant data and
 *              cannot publish.
 *  - dataops:  the review/admin back office. Reviews and publishes corpus content. No access
 *              to tenant data.
 */
export const DB_ROLES = {
  migrator: 'legalintel_migrator',
  app: 'legalintel_app',
  ingest: 'legalintel_ingest',
  dataops: 'legalintel_dataops',
} as const;

export type DbRole = keyof typeof DB_ROLES;
export type DbRoleName = (typeof DB_ROLES)[DbRole];

export const RUNTIME_ROLES = ['app', 'ingest', 'dataops'] as const satisfies readonly DbRole[];

/** Throwaway credentials for local development and tests only. Never used outside loopback. */
export const DEV_ROLE_PASSWORD = 'legalintel_dev';

export type RolePasswords = Readonly<Record<DbRole, string>>;

export function devRolePasswords(): RolePasswords {
  return {
    migrator: DEV_ROLE_PASSWORD,
    app: DEV_ROLE_PASSWORD,
    ingest: DEV_ROLE_PASSWORD,
    dataops: DEV_ROLE_PASSWORD,
  };
}

/** Advisory-lock key serialising role/template provisioning across concurrent processes. */
export const PROVISIONING_LOCK_KEY = 7_331_002;

/**
 * Idempotently creates the roles and re-asserts their attributes on every run, so attribute
 * drift (someone granting BYPASSRLS by hand) is corrected rather than preserved.
 *
 * Requires a role with CREATEROLE. In production this is done by infrastructure tooling with
 * real secrets; this function exists for local development and tests.
 */
export async function bootstrapRoles(admin: Client, passwords: RolePasswords): Promise<void> {
  await admin.query('SELECT pg_advisory_lock($1)', [PROVISIONING_LOCK_KEY]);
  try {
    for (const role of Object.keys(DB_ROLES) as DbRole[]) {
      const name = admin.escapeIdentifier(DB_ROLES[role]);
      const password = admin.escapeLiteral(passwords[role]);

      await admin.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${admin.escapeLiteral(DB_ROLES[role])}) THEN
             CREATE ROLE ${name} LOGIN;
           END IF;
         END $$`,
      );
      await admin.query(
        `ALTER ROLE ${name} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${password}`,
      );

      if (role !== 'migrator') {
        // Runtime roles get conservative defaults so one runaway query or forgotten
        // transaction cannot exhaust the database. The migrator is exempt: migrations
        // legitimately run long.
        await admin.query(`ALTER ROLE ${name} SET statement_timeout = '30s'`);
        await admin.query(`ALTER ROLE ${name} SET idle_in_transaction_session_timeout = '60s'`);
        await admin.query(`ALTER ROLE ${name} SET lock_timeout = '10s'`);
      }
    }
  } finally {
    await admin.query('SELECT pg_advisory_unlock($1)', [PROVISIONING_LOCK_KEY]);
  }
}

/**
 * Removes default access for everyone except the named roles. Without this, any role in the
 * cluster can connect to, and create objects in, the application database.
 */
export async function hardenDatabase(admin: Client, databaseName: string): Promise<void> {
  const database = admin.escapeIdentifier(databaseName);
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  for (const role of Object.keys(DB_ROLES) as DbRole[]) {
    await admin.query(
      `GRANT CONNECT ON DATABASE ${database} TO ${admin.escapeIdentifier(DB_ROLES[role])}`,
    );
  }
}
