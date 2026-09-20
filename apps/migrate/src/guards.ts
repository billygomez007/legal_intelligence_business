import { APP_ENVIRONMENTS, ConfigError } from '@legalintel/config';
import { createPool } from '@legalintel/db';
import { assertNoSyntheticInProduction } from '@legalintel/legal-corpus';

/**
 * Checks that must hold before a deployment is considered good. Kept in the composition root
 * because it needs the legal-corpus package, which the database package must not depend on.
 *
 * Fabricated authority must never reach a user (AGENTS.md). If a production database contains
 * synthetic fixtures (a mis-pointed seed script, a restored development dump), a production
 * deploy fails here instead of quietly serving them. The API and worker apply the same guard at
 * their own startup when they exist.
 *
 * Fails closed: an environment this code does not recognise is an error, never "not production".
 */
export async function assertProductionSafety(migratorUrl: string, appEnv: string): Promise<void> {
  if (!(APP_ENVIRONMENTS as readonly string[]).includes(appEnv)) {
    throw new ConfigError([
      {
        variable: 'APP_ENV',
        problem: `is not a recognised environment, so production safety checks cannot be decided. Expected one of: ${APP_ENVIRONMENTS.join(', ')}`,
      },
    ]);
  }
  if (appEnv !== 'production') return;
  const pool = createPool({
    connectionString: migratorUrl,
    applicationName: 'migrate-production-guard',
    max: 1,
  });
  try {
    await assertNoSyntheticInProduction(pool, appEnv);
  } finally {
    await pool.end();
  }
}
