import { once } from 'node:events';

import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool, withPublicTransaction } from '../src';
import { createTestDatabase, type TestDatabase } from '../src/testing';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

describe('real PostgreSQL connection termination', () => {
  it('rejects a disconnected transaction and gives the next borrower a fresh, empty context', async () => {
    const pool = createPool({
      connectionString: database.urlFor('app'),
      applicationName: 'transaction-disconnect-test',
      max: 1,
    });
    let checkedOut: PoolClient | undefined;
    pool.on('acquire', (client) => {
      checkedOut = client;
    });
    let terminatedPid: number | undefined;
    try {
      await expect(
        withPublicTransaction(pool, async (tx) => {
          const result = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          terminatedPid = result.rows[0]?.pid;
          expect(terminatedPid).toBeTypeOf('number');
          if (checkedOut === undefined) throw new Error('client was not acquired');
          // Observe the server event deterministically; no timing-based sleep. Unit tests
          // separately prove the helper itself handles events without another listener.
          const disconnected = once(checkedOut, 'error');
          await database.withAdmin((admin) =>
            admin.query('SELECT pg_terminate_backend($1)', [terminatedPid]),
          );
          await disconnected;
          await expect(tx.query('SELECT 1')).rejects.toThrow();
          return 'must not commit';
        }),
      ).rejects.toThrow();
      const next = await withPublicTransaction(pool, (tx) =>
        tx.query<{ pid: number; org: string | null; user_id: string | null }>(
          'SELECT pg_backend_pid() AS pid, app.current_org_id() AS org, app.current_user_id() AS user_id',
        ),
      );
      expect(next.rows[0]?.pid).not.toBe(terminatedPid);
      expect(next.rows[0]).toMatchObject({ org: null, user_id: null });
    } finally {
      await pool.end();
    }
  });
});
