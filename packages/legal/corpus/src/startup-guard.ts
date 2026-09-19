import type { DbPool } from '@legalintel/db';
import { withPublicTransaction } from '@legalintel/db';
import { internalError } from '@legalintel/kernel';

import { corpusStore } from './adapters/pg-corpus-store';

/**
 * Fabricated authority must never reach a user (AGENTS.md). Test fixtures live under
 * jurisdictions flagged synthetic; a service running in production refuses to start if any
 * exist, so a mis-pointed seed script or restored dev dump fails loudly at boot.
 */
export async function assertNoSyntheticInProduction(pool: DbPool, appEnv: string): Promise<void> {
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
