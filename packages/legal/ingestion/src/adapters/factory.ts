import { assertRuntimeRoleIsConstrained, type DbPool } from '@legalintel/db';
import { assertNoSyntheticInProduction } from '@legalintel/legal-corpus';
import { IngestionPipeline, type PipelineDependencies } from '../application/pipeline';
import { PgIngestionStore } from './pg-store';
import { hash } from './local-storage';

export function createIngestionPipeline(
  options: Omit<PipelineDependencies, 'store' | 'assertSafe' | 'checksum'> & {
    pool: DbPool;
    environment: 'test' | 'development' | 'production';
  },
): IngestionPipeline {
  return new IngestionPipeline({
    ...options,
    store: new PgIngestionStore(options.pool),
    checksum: hash,
    async assertSafe() {
      await assertRuntimeRoleIsConstrained(options.pool);
      const role = await options.pool.query<{ name: string }>('SELECT current_user AS name');
      if (role.rows[0]?.name !== 'legalintel_ingest')
        throw new Error('Ingestion requires the ingestion database role.');
      await assertNoSyntheticInProduction(options.pool, options.environment);
    },
  });
}
