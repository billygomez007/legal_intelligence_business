import { OrganizationId, UserId, internalError } from '@legalintel/kernel';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * The narrow interface handed to application code inside a transaction. It deliberately does
 * not expose the underlying client, so callers cannot COMMIT, release the connection, or hold
 * it past the end of the transaction.
 */
export interface Tx {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface TenantScope {
  readonly organizationId: OrganizationId;
  /** The acting user, when there is one. Used by "own rows" policies and audit. */
  readonly userId?: UserId;
}

export interface TransactionOptions {
  readonly isolation?: 'read committed' | 'repeatable read' | 'serializable';
  readonly readOnly?: boolean;
  readonly statementTimeoutMs?: number;
}

function beginStatement(options: TransactionOptions): string {
  const parts = ['BEGIN'];
  if (options.isolation !== undefined)
    parts.push(`ISOLATION LEVEL ${options.isolation.toUpperCase()}`);
  if (options.readOnly === true) parts.push('READ ONLY');
  return parts.join(' ');
}

async function runInTransaction<T>(
  pool: Pool,
  context: { orgId: string; userId: string },
  options: TransactionOptions,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  let active = true;
  let released = false;
  const release = (error?: Error | boolean) => {
    if (released) return;
    released = true;
    client.release(error);
  };

  const tx: Tx = {
    // async so that misuse surfaces as a rejected promise like every other query failure,
    // rather than a synchronous throw callers do not expect from a Promise-returning method.
    async query(text, values) {
      if (!active) {
        throw internalError(
          'db.tx_closed',
          'A transaction handle was used after its transaction ended.',
        );
      }
      return await client.query(text, values === undefined ? undefined : [...values]);
    },
  };

  try {
    await client.query(beginStatement(options));

    // `true` makes the setting local to this transaction. It is discarded at COMMIT or
    // ROLLBACK, so it cannot leak to the next borrower of a pooled connection, and it is safe
    // behind a transaction-mode connection pooler.
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'app.org_id',
      context.orgId,
      'app.user_id',
      context.userId,
    ]);
    if (options.statementTimeoutMs !== undefined) {
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(options.statementTimeoutMs)}`);
    }

    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // A connection that cannot roll back is in an unknown state. Destroy it rather than
      // returning it to the pool where the next request would inherit that state.
      release(rollbackError instanceof Error ? rollbackError : true);
    }
    throw error;
  } finally {
    active = false;
    release();
  }
}

/**
 * Runs `fn` with the tenant context set, so row-level security limits every statement to
 * that organization. This is the only supported way to touch tenant-owned tables.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  // Re-validate: a branded type is compile-time only and can be cast around.
  const orgId = OrganizationId.parse(scope.organizationId);
  const userId = scope.userId === undefined ? '' : UserId.parse(scope.userId);
  return runInTransaction(pool, { orgId, userId }, options, fn);
}

/**
 * Runs `fn` with an explicitly empty tenant context. Use for reads of the shared corpus and
 * for system paths. Any tenant-owned table touched inside returns no rows, which is the point:
 * forgetting to choose a tenant fails closed instead of open.
 */
export async function withPublicTransaction<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return runInTransaction(pool, { orgId: '', userId: '' }, options, fn);
}
