import {
  bootstrapEnvSchema,
  loadConfigFromProcessEnv,
  migratorEnvSchema,
} from '@legalintel/config';
import pg from 'pg';

import type { MigrationSet } from '../migrate/files';
import { getMigrationStatus, runMigrations } from '../migrate/runner';
import { REQUIRED_ROLES } from '../migrate/sets';
import { DB_ROLES, bootstrapRoles, devRolePasswords, hardenDatabase } from '../roles';

/**
 * Local-development and deploy tooling.
 *
 *   bootstrap  create the database roles (dev only: refuses non-loopback hosts)
 *   migrate    apply pending migrations as the migrator role
 *   status     show applied / pending / drifted migrations
 *   setup      bootstrap + create the database if missing + migrate
 *
 * The set list is supplied by the caller: this package must not know about packages that
 * depend on it. A composition root (apps/migrate) lists every set in dependency order.
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

async function migrate(sets: readonly MigrationSet[]): Promise<void> {
  const { MIGRATOR_DATABASE_URL } = loadConfigFromProcessEnv(migratorEnvSchema);
  const report = await withClient(MIGRATOR_DATABASE_URL.reveal(), (client) =>
    runMigrations(client, {
      sets,
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

async function status(sets: readonly MigrationSet[]): Promise<void> {
  const { MIGRATOR_DATABASE_URL } = loadConfigFromProcessEnv(migratorEnvSchema);
  const rows = await withClient(MIGRATOR_DATABASE_URL.reveal(), (client) =>
    getMigrationStatus(client, sets),
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

export interface MigrationCliOptions {
  /**
   * Runs after `migrate`, `setup` or `status` succeeds, with the migrator connection string.
   * A throw fails the command (exit code 1). Used by the composition root for checks that need
   * knowledge of packages this one must not depend on, such as "no synthetic fixtures exist".
   */
  readonly afterCommand?: (context: { command: string; migratorUrl: string }) => Promise<void>;
}

const HOOKED_COMMANDS = new Set(['migrate', 'setup', 'status']);

/** Runs the CLI for the given migration sets. Sets exit code 1 on failure, 2 on bad usage. */
export async function runMigrationCli(
  sets: readonly MigrationSet[],
  argv: readonly string[] = process.argv.slice(2),
  options: MigrationCliOptions = {},
): Promise<void> {
  const command = argv[0] ?? '';
  try {
    switch (command) {
      case 'bootstrap':
        await bootstrap();
        break;
      case 'migrate':
        await migrate(sets);
        break;
      case 'status':
        await status(sets);
        break;
      case 'setup':
        await bootstrap();
        await createDatabaseIfMissing();
        await migrate(sets);
        break;
      default:
        console.error('Usage: <bootstrap|migrate|status|setup>');
        process.exitCode = 2;
    }

    if (options.afterCommand !== undefined && HOOKED_COMMANDS.has(command)) {
      const { MIGRATOR_DATABASE_URL } = loadConfigFromProcessEnv(migratorEnvSchema);
      await options.afterCommand({ command, migratorUrl: MIGRATOR_DATABASE_URL.reveal() });
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
