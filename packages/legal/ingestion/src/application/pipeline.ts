import { enforce, type AuthzContext } from '@legalintel/iam';
import { withSpan, type Logger } from '@legalintel/observability';
import { z } from 'zod';
import {
  failureCategory,
  IngestionFailure,
  MAX_BYTES,
  MAX_TEXT,
  requestSchema,
  type Job,
} from '../domain/model';
import { validateParsed } from '../domain/parser';
import type {
  ArtifactStorage,
  DocumentParser,
  SourceAcquirer,
  TextExtractor,
} from '../ports/pipeline';
import type { IngestionStore } from '../ports/store';

export interface PipelineDependencies {
  store: IngestionStore;
  storage: ArtifactStorage;
  acquirer: SourceAcquirer;
  extractor: TextExtractor;
  parsers: readonly DocumentParser[];
  logger: Logger;
  /** Composition root checks runtime role and production synthetic guard before each run/request. */
  assertSafe: () => Promise<void>;
  checksum: (bytes: Uint8Array) => string;
}

export class IngestionPipeline {
  constructor(private readonly deps: PipelineDependencies) {}
  async request(context: AuthzContext, input: unknown): Promise<Job> {
    enforce(context, 'ingestion:request');
    if (context.organizationId !== null || context.principal.kind !== 'user')
      throw new IngestionFailure('input_invalid');
    const result = requestSchema.safeParse(input);
    if (!result.success || result.data.actorId !== context.principal.userId)
      throw new IngestionFailure('input_invalid');
    await this.deps.assertSafe();
    if (!this.deps.parsers.some((p) => p.id === result.data.parserId))
      throw new IngestionFailure('parse_failed');
    return this.deps.store.request(result.data);
  }
  async run(id: string): Promise<Job> {
    if (!z.uuid().safeParse(id).success) throw new IngestionFailure('input_invalid');
    await this.deps.assertSafe();
    const { store, storage, acquirer, extractor, logger } = this.deps;
    await store.withLock(id, async () => {
      let job = await store.get(id);
      const started = performance.now();
      try {
        const claimed = await store.claim(id);
        if (claimed === null) return;
        job = claimed;
        await withSpan(
          'ingestion.run',
          { 'ingestion.job_id': id, 'ingestion.attempt': job.attempts },
          async () => {
            let artifact = await store.artifact(job);
            if (artifact === null) {
              await store.stage(job, 'acquisition');
              const bytes = await acquirer.acquire(job.request);
              if (bytes.length === 0 || bytes.length > MAX_BYTES)
                throw new IngestionFailure('input_invalid');
              if (this.deps.checksum(bytes) !== job.request.expectedChecksum)
                throw new IngestionFailure('integrity_failed');
              await store.stage(job, 'storage');
              const key = await storage.put(
                job.request.sourceId,
                job.request.expectedChecksum,
                bytes,
              );
              artifact = await store.saveArtifact(
                job,
                key,
                bytes.length,
                performance.now() - started,
              );
            }
            await store.stage(job, 'extraction');
            // Verify the original survives and is unchanged on every run, including resumption.
            const bytes = await storage.get(
              job.request.sourceId,
              artifact.storageKey,
              artifact.checksum,
            );
            if (
              bytes.length !== artifact.byteSize ||
              this.deps.checksum(bytes) !== artifact.checksum
            )
              throw new IngestionFailure('integrity_failed');
            let extraction = await store.extraction(job);
            if (extraction === null) {
              extraction = await extractor.extract(bytes, job.request.mediaType);
              if (
                extraction.text.length < 20 ||
                extraction.text.length > MAX_TEXT ||
                !Number.isFinite(extraction.quality) ||
                extraction.quality < 0 ||
                extraction.quality > 1
              )
                throw new IngestionFailure('extraction_quality_low');
              await store.saveExtraction(job, artifact, extraction, performance.now() - started);
            }
            await store.stage(job, 'parsing');
            const parser = this.deps.parsers.find((p) => p.id === job.request.parserId);
            if (parser === undefined) throw new IngestionFailure('parse_failed');
            const parsed = parser.parse(extraction, job.request);
            validateParsed(extraction.text, parsed);
            await store.stage(job, 'validation');
            await store.submit(job, artifact, extraction, parsed, performance.now() - started);
          },
        );
        logger.info(
          {
            jobId: id,
            correlationId: job.request.correlationId,
            stage: 'review',
            attempt: job.attempts,
            durationMs: Math.round(performance.now() - started),
          },
          'ingestion run completed',
        );
      } catch (error) {
        const category = failureCategory(error);
        await store.fail(job, category, performance.now() - started);
        logger.warn(
          {
            jobId: id,
            correlationId: job.request.correlationId,
            stage: job.stage,
            category,
            attempt: job.attempts,
            durationMs: Math.round(performance.now() - started),
          },
          'ingestion run stopped',
        );
      }
    });
    return store.get(id);
  }
}
