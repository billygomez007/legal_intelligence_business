import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

import { createPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PgIngestionStore } from '../src';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

it('reports loss of the real advisory-lock session and permits a subsequent job to acquire it', async () => {
  const pool = createPool({
    connectionString: database.urlFor('ingest'),
    applicationName: 'ingestion-lock-disconnect-test',
    max: 1,
  });
  const store = new PgIngestionStore(pool);
  const job = randomUUID();
  let disconnected: Promise<unknown[]> | undefined;
  pool.on('acquire', (client) => {
    disconnected ??= once(client, 'error');
  });
  // Register a deterministic observer before starting the callback. It does not hold or
  // release the connection; the production store owns the entire lock lifecycle.
  const failed = store.withLock(job, async () => {
    await database.withAdmin((admin) =>
      admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND application_name = $2`,
        [database.name, 'ingestion-lock-disconnect-test'],
      ),
    );
    if (disconnected === undefined) throw new Error('client was not acquired');
    await disconnected;
    return 'must not succeed';
  });
  try {
    await expect(failed).rejects.toThrow();
    await expect(store.withLock(job, () => Promise.resolve('next job'))).resolves.toBe('next job');
  } finally {
    await pool.end();
  }
});
