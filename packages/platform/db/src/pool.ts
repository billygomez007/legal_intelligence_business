import { AppError } from '@legalintel/kernel';
import pg from 'pg';

/** The pooled-connection type, re-exported so packages depend on this one, not on the driver. */
export type DbPool = pg.Pool;

export interface PoolOptions {
  readonly connectionString: string;
  /** Shown in `pg_stat_activity`; makes it possible to tell which service holds a connection. */
  readonly applicationName: string;
  readonly max?: number;
  readonly connectionTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  /** Idle clients can error (network drop, server restart). Unhandled, that crashes the process. */
  readonly onError?: (error: Error) => void;
}

export function createPool(options: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
  });
  pool.on('error', (error) => {
    options.onError?.(error);
  });
  return pool;
}

interface RoleFacts {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  owned_relations: string;
}

/**
 * Refuses to start if the connection is more privileged than a runtime role should be.
 *
 * Superusers and roles with BYPASSRLS ignore every row-level-security policy, and so does
 * a table owner that is not subject to FORCE. A misconfigured DATABASE_URL pointing at the
 * wrong role would silently disable tenant isolation while every test still passed, so this
 * check runs at process start.
 */
export async function assertRuntimeRoleIsConstrained(pool: pg.Pool): Promise<void> {
  const result = await pool.query<RoleFacts>(
    `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid) AS owned_relations
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const facts = result.rows[0];
  if (facts === undefined) {
    throw new AppError('internal', 'db.role_unknown', 'Could not determine the connected role.');
  }

  const problems: string[] = [];
  if (facts.rolsuper) problems.push('is a superuser');
  if (facts.rolbypassrls) problems.push('has BYPASSRLS');
  if (facts.rolcreaterole) problems.push('can create roles');
  if (facts.rolcreatedb) problems.push('can create databases');
  if (Number(facts.owned_relations) > 0) problems.push('owns tables or views');

  if (problems.length > 0) {
    throw new AppError(
      'internal',
      'db.runtime_role_unsafe',
      `Database role "${facts.rolname}" is not safe for runtime use: it ${problems.join(', ')}. ` +
        'Row-level security would not protect tenant data. Connect as the application role.',
    );
  }
}
