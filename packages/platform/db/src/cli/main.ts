import {
  bootstrapEnvSchema,
  loadConfigFromProcessEnv,
  migratorEnvSchema,
} from '@legalintel/config';
import pg from 'pg';

import { getMigrationStatus, runMigrations } from '../migrate/runner';
import { REQUIRED_ROLES, platformMigrations } from '../migrate/sets';
import { DB_ROLES, bootstrapRoles, devRolePasswords, hardenDatabase } from '../roles';

/**
 * Local-development and deploy tooling.
 *
 *   bootstrap  create the database roles (dev only: refuses non-loopback hosts)
 *   migrate    apply pending migrations as the migrator role
 *   status     show applied / pending / drifted migrations
 *   setup      bootstrap + create the database if missing + migrate
 *
 * This package migrates only the platform set. The composition root that also knows the
 * legal-domain sets (platform must not import legal) lists all sets in dependency order.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function withClient<T>(connectionString: string, fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function bootstrap(): Promise<void> {
  const { DB_BOOTSTRAP_ADMIN_URL } = loadConfigFromProcessEnv(bootstrapEnvSchema);
  const url = DB_BOOTSTRAP_ADMIN_URL.reveal();

  // This creates roles with throwaway passwords. Pointing it at a real database would
  // provision a production role with a password that is published in this repository.
  if (!LOOPBACK_HOSTS.has(new URL(url).hostname)) {
    throw new Error(
      'Refusing to bootstrap roles with development passwords on a non-loopback host. ' +
        'Provision production roles with real secrets through your infrastructure tooling.',
    );
  }

  await withClient(url, (client) => bootstrapRoles(client, devRolePasswords()));
  console.log(`Roles ready: ${Object.values(DB_ROLES).join(', ')}`);
}

async function createDatabaseIfMissing(): Promise<void> {
  const { DB_BOOTSTRAP_ADMIN_URL } = loadConfigFromProcessEnv(bootstrapEnvSchema);
  const { MIGRATOR_DATABASE_URL } = loadConfigFromProcessEnv(migratorEnvSchema);
  const name = decodeURIComponent(new URL(MIGRATOR_DATABASE_URL.reveal()).pathname.slice(1));

  await withClient(DB_BOOTSTRAP_ADMIN_URL.reveal(), async (admin) => {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await admin.query(
        `CREATE DATABASE ${admin.escapeIdentifier(name)} OWNER ${admin.escapeIdentifier(DB_ROLES.migrator)}`,
      );
      console.log(`Created database ${name}`);
    }
    await hardenDatabase(admin, name);
  });
}

async function migrate(): Promise<void> {
  const { MIGRATOR_DATABASE_URL } = loadConfigFromProcessEnv(migratorEnvSchema);
  const report = await withClient(MIGRATOR_DATABASE_URL.reveal(), (client) =>
    runMigrations(client, {
      sets: [platformMigrations],
      requiredRoles: REQUIRED_ROLES,
      onEvent: (event) => {
        if (event.type === 'applied') {
          console.log(
            `applied  ${event.set}/${String(event.version).padStart(4, '0')}_${event.name} (${event.durationMs}ms)`,
          );
        }
      },
    }),
  );
  console.log(`${report.applied.length} applied, ${report.alreadyApplied} already up to date`);
}

async function status(): Promise<void> {
  const { MIGRATOR_DATABASE_URL } = loadConfigFromProcessEnv(migratorEnvSchema);
  const rows = await withClient(MIGRATOR_DATABASE_URL.reveal(), (client) =>
    getMigrationStatus(client, [platformMigrations]),
  );
  for (const row of rows) {
    console.log(
      `${row.state.padEnd(18)} ${row.set}/${String(row.version).padStart(4, '0')}_${row.name}`,
    );
  }
  if (rows.some((row) => row.state === 'checksum_mismatch' || row.state === 'missing_file')) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  switch (command) {
    case 'bootstrap':
      return bootstrap();
    case 'migrate':
      return migrate();
    case 'status':
      return status();
    case 'setup':
      await bootstrap();
      await createDatabaseIfMissing();
      return migrate();
    default:
      console.error('Usage: main.ts <bootstrap|migrate|status|setup>');
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
