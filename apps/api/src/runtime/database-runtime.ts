import { assertRuntimeRoleIsConstrained, createPool, type DbPool } from '@legalintel/db';

export interface LawAfriqueDatabaseRuntimeConfig {
  readonly connectionString: string;

  readonly max: number;
}

export function createLawAfriqueDatabasePool(config: LawAfriqueDatabaseRuntimeConfig): DbPool {
  return createPool({
    connectionString: config.connectionString,

    applicationName: 'law-afrique-api',

    max: config.max,
  });
}

/**
 * Mandatory startup safety gate.
 *
 * Refuses superuser, BYPASSRLS, table-owner and other over-privileged
 * PostgreSQL identities before serving tenant traffic.
 */
export async function verifyLawAfriqueRuntimeDatabase(pool: DbPool): Promise<void> {
  await assertRuntimeRoleIsConstrained(pool);
}
