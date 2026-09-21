import { EventEmitter } from 'node:events';

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { withPublicTransaction, type Tx } from '../src';

function connection() {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn((_sql: string) => Promise.resolve({ rows: [] })),
    release: vi.fn((_error?: Error | boolean) => undefined),
  });
  // Only the driver boundary is simulated: exercise the real transaction helper.
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { client, pool };
}

describe('checked-out connection failures', () => {
  it('handles repeated error events between queries and never commits a failed connection', async () => {
    const { client, pool } = connection();
    const failure = new Error('connection lost');
    await expect(
      withPublicTransaction(pool, async (tx) => {
        expect(() => client.emit('error', failure)).not.toThrow();
        expect(() => client.emit('error', new Error('connection ended'))).not.toThrow();
        await expect(tx.query('SELECT 1')).rejects.toBe(failure);
        return 'must not succeed';
      }),
    ).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
    expect(client.listenerCount('error')).toBe(0);
  });

  it.each(['BEGIN', 'COMMIT', 'ROLLBACK'])(
    'handles an error event during %s and destroys the connection exactly once',
    async (stage) => {
      const { client, pool } = connection();
      const failure = new Error(`lost during ${stage}`);
      client.query.mockImplementation((sql) => {
        if (sql === stage) {
          client.emit('error', failure);
          return Promise.reject(failure);
        }
        return Promise.resolve({ rows: [] });
      });
      await expect(
        withPublicTransaction(pool, () => {
          if (stage === 'ROLLBACK') return Promise.reject(new Error('application failed'));
          return Promise.resolve('done');
        }),
      ).rejects.toBe(failure);
      expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
      expect(client.listenerCount('error')).toBe(0);
    },
  );

  it('rolls back ordinary application failures and preserves the original error', async () => {
    const { client, pool } = connection();
    const failure = new Error('application failed');
    await expect(withPublicTransaction(pool, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('destroys a connection when rollback fails without an error event', async () => {
    const { client, pool } = connection();
    const failure = new Error('application failed');
    const rollbackFailure = new Error('rollback failed');
    client.query.mockImplementation((sql) =>
      sql === 'ROLLBACK' ? Promise.reject(rollbackFailure) : Promise.resolve({ rows: [] }),
    );
    await expect(withPublicTransaction(pool, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(rollbackFailure);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('removes only its own listener after release and closes successful transaction handles', async () => {
    const { client, pool } = connection();
    const existingListener = vi.fn();
    client.on('error', existingListener);
    client.release.mockImplementation(() => {
      expect(client.listenerCount('error')).toBe(2);
    });
    let retained: Tx | undefined;
    for (let n = 0; n < 12; n += 1) {
      await expect(
        withPublicTransaction(pool, (tx) => {
          retained = tx;
          return Promise.resolve(n);
        }),
      ).resolves.toBe(n);
      expect(client.listeners('error')).toEqual([existingListener]);
    }
    await expect(retained?.query('SELECT 1')).rejects.toMatchObject({ code: 'db.tx_closed' });
    expect(client.release).toHaveBeenCalledTimes(12);
  });
});
