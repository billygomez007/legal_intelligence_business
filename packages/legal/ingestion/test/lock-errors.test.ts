import { EventEmitter } from 'node:events';

import type { DbPool } from '@legalintel/db';
import { describe, expect, it, vi } from 'vitest';

import { PgIngestionStore } from '../src';

function connection(locked = true) {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn((_sql: string) => Promise.resolve({ rows: [{ locked }] })),
    release: vi.fn((_error?: Error | boolean) => undefined),
  });
  const pool = { connect: () => Promise.resolve(client) } as unknown as DbPool;
  return { client, store: new PgIngestionStore(pool) };
}

describe('ingestion lock connection failures', () => {
  it('handles repeated disconnect events while work runs and refuses success after lock loss', async () => {
    const { client, store } = connection();
    const failure = new Error('lock connection lost');
    await expect(
      store.withLock('job', () => {
        expect(() => client.emit('error', failure)).not.toThrow();
        expect(() => client.emit('error', new Error('connection ended'))).not.toThrow();
        return Promise.resolve('must not succeed');
      }),
    ).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('does not start work when acquiring the lock loses the connection', async () => {
    const { client, store } = connection();
    const failure = new Error('connection lost');
    client.query.mockImplementation(() => {
      client.emit('error', failure);
      return Promise.reject(failure);
    });
    const work = vi.fn(() => Promise.resolve('done'));
    await expect(store.withLock('job', work)).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('does not swallow a disconnect during lock release', async () => {
    const { client, store } = connection();
    const failure = new Error('connection lost');
    client.query.mockImplementation((sql) => {
      if (sql.includes('pg_advisory_unlock')) {
        client.emit('error', failure);
        return Promise.reject(failure);
      }
      return Promise.resolve({ rows: [{ locked: true }] });
    });
    await expect(store.withLock('job', () => Promise.resolve('done'))).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('does not run work when another worker holds the lock', async () => {
    const { client, store } = connection(false);
    const work = vi.fn(() => Promise.resolve('done'));
    await expect(store.withLock('job', work)).resolves.toBeNull();
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('unlocks after callback failures and preserves their errors', async () => {
    const { client, store } = connection();
    const failure = new Error('work failed');
    await expect(store.withLock('job', () => Promise.reject(failure))).rejects.toBe(failure);
    expect(client.query.mock.lastCall?.[0]).toContain('pg_advisory_unlock');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('preserves other listeners without accumulating listeners across jobs', async () => {
    const { client, store } = connection();
    const existing = vi.fn();
    client.on('error', existing);
    client.release.mockImplementation(() => {
      expect(client.listenerCount('error')).toBe(2);
    });
    for (let n = 0; n < 12; n += 1) {
      await expect(store.withLock('job', () => Promise.resolve(n))).resolves.toBe(n);
      expect(client.listeners('error')).toEqual([existing]);
    }
  });
});
