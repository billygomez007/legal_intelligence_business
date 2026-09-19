import pg from 'pg';

import { adminConnectionString } from './harness';

/**
 * Drops every test database and cached template on the test cluster. Templates are rebuilt on
 * demand, so this is always safe; run it after changing migrations a lot or when a crashed run
 * left databases behind. Wired to `pnpm db:test:clean`.
 */
const client = new pg.Client({ connectionString: adminConnectionString() });
await client.connect();
try {
  const result = await client.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname ~ '^lip_(tpl|test)_'`,
  );
  for (const { datname } of result.rows) {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(datname)} WITH (FORCE)`);
    console.log(`dropped ${datname}`);
  }
  console.log(`${result.rows.length} database(s) removed`);
} finally {
  await client.end();
}
