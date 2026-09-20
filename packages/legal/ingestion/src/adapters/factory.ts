import { assertRuntimeRoleIsConstrained, type DbPool } from '@legalintel/db';
import { assertNoSyntheticInProduction, type KNOWN_ENVIRONMENTS } from '@legalintel/legal-corpus';

import { IngestionPipeline, type PipelineDependencies } from '../application/pipeline';
import { hash } from './local-storage';
import { PgIngestionStore } from './pg-store';
import { IngestionReview } from './review';

/** development, test, staging or production: the same names the corpus guard recognises. */
type Environment = (typeof KNOWN_ENVIRONMENTS)[number];

/**
 * The checks every entry point runs before acting: the pool is the expected constrained role,
 * and synthetic authorities are not present in production. Both fail closed.
 */
function safetyCheck(pool: DbPool, role: string, environment: Environment): () => Promise<void> {
  return async () => {
    await assertRuntimeRoleIsConstrained(pool);
    const current = await pool.query<{ name: string }>('SELECT current_user AS name');
    if (current.rows[0]?.name !== role)
      throw new Error(`Ingestion requires the ${role} database role.`);
    await assertNoSyntheticInProduction(pool, environment);
  };
}

export function createIngestionPipeline(
  options: Omit<PipelineDependencies, 'store' | 'assertSafe' | 'checksum'> & {
    pool: DbPool;
    environment: Environment;
  },
): IngestionPipeline {
  return new IngestionPipeline({
    ...options,
    store: new PgIngestionStore(options.pool),
    checksum: hash,
    assertSafe: safetyCheck(options.pool, 'legalintel_ingest', options.environment),
  });
}

/** Review runs as the data-operations role, with the same production checks. */
export function createIngestionReview(options: {
  pool: DbPool;
  environment: Environment;
}): IngestionReview {
  return new IngestionReview(
    options.pool,
    safetyCheck(options.pool, 'legalintel_dataops', options.environment),
  );
}
