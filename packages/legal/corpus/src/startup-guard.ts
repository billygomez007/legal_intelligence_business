import type { DbPool } from '@legalintel/db';
import { withPublicTransaction } from '@legalintel/db';
import { internalError } from '@legalintel/kernel';

import { corpusStore } from './adapters/pg-corpus-store';

/**
 * The environment names the guard understands. They mirror `APP_ENVIRONMENTS` in the
 * configuration package (this package does not depend on it; a test in the composition root
 * fails if the two ever differ).
 */
export const KNOWN_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;

/**
 * Fabricated authority must never reach a user (AGENTS.md). Test fixtures live under
 * jurisdictions flagged synthetic; a service running in production refuses to start if any
 * exist, so a mis-pointed seed script or restored dev dump fails loudly at boot.
 *
 * Fails closed: the guard is switched by the environment name, so a name it does not recognise
 * ("prod", "", a stray space) is an error. Treating it as "not production" would let a typo
 * switch the check off.
 */
export async function assertNoSyntheticInProduction(pool: DbPool, appEnv: string): Promise<void> {
  if (!(KNOWN_ENVIRONMENTS as readonly string[]).includes(appEnv)) {
    throw internalError(
      'corpus.unknown_environment',
      `Refusing to decide whether synthetic fixtures are allowed: the environment is not one of ${KNOWN_ENVIRONMENTS.join(', ')}.`,
    );
  }
  if (appEnv !== 'production') return;
  const count = await withPublicTransaction(
    pool,
    (tx) => corpusStore.countSyntheticJurisdictions(tx),
    { readOnly: true },
  );
  if (count > 0) {
    throw internalError(
      'corpus.synthetic_in_production',
      `Refusing to start: ${count} synthetic jurisdiction(s) exist in a production database. Fixtures must never be loaded here.`,
    );
  }
}
