import { enforce, type AuthzContext } from '@legalintel/iam';
import {
  incrementCounter,
  recordHistogram,
  withSpan,
  type Logger,
} from '@legalintel/observability';
import { z } from 'zod';

import {
  codePointLength,
  failureCategory,
  IngestionFailure,
  MAX_BYTES,
  MAX_TEXT,
  MIN_EXTRACTION_QUALITY,
  MIN_VISIBLE_CHARACTERS,
  requestSchema,
  type Extraction,
  type FailureCategory,
  type Job,
  type ParsedDocument,
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

/** SQLSTATE or a stable code, for logs. Never the message: drivers quote values in it. */
const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const since = (start: number): number => performance.now() - start;

/**
 * Request and run ingestion jobs. This class never publishes and never decides: a successful
 * run ends with a corpus version awaiting human review.
 */
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
      throw new IngestionFailure('input_invalid');
    try {
      return await this.deps.store.request(result.data);
    } catch (error) {
      throw this.typed(error, 'request');
    }
  }

  /** Runs every job that is ready, one at a time. Returns the jobs as they now stand. */
  async runReady(limit = 10): Promise<Job[]> {
    const ids = await this.deps.store.ready(limit);
    const jobs: Job[] = [];
    for (const id of ids) jobs.push(await this.run(id));
    return jobs;
  }

  async run(id: string): Promise<Job> {
    if (!z.uuid().safeParse(id).success) throw new IngestionFailure('input_invalid');
    await this.deps.assertSafe();
    await this.deps.store.withLock(id, () => this.process(id));
    return this.deps.store.get(id);
  }

  /** A typed failure for callers; the underlying error is logged by code only. */
  private typed(error: unknown, where: string): IngestionFailure {
    const category = failureCategory(error);
    this.deps.logger.error(
      { category, where, code: errorCode(error) },
      'ingestion operation failed',
    );
    return error instanceof IngestionFailure ? error : new IngestionFailure(category);
  }

  private async process(id: string): Promise<void> {
    const { store, logger } = this.deps;
    const started = performance.now();
    let job: Job | null;
    try {
      job = await store.claim(id);
    } catch (error) {
      // Nothing was claimed, so there is no running job to mark failed.
      throw this.typed(error, 'claim');
    }
    if (job === null) return;
    const claimed = job;
    try {
      await withSpan(
        'ingestion.run',
        { 'ingestion.job_id': id, 'ingestion.attempt': claimed.attempts },
        () => this.execute(claimed),
      );
      logger.info(
        {
          jobId: id,
          correlationId: claimed.request.correlationId,
          stage: 'review',
          attempt: claimed.attempts,
          durationMs: Math.round(since(started)),
        },
        'ingestion run completed',
      );
      this.measure('pending_review', undefined, since(started));
    } catch (error) {
      const category = failureCategory(error);
      try {
        await store.fail(claimed, category, since(started));
      } catch (failure) {
        // The job cannot be marked. It stays 'running' and is closed out by a later pass; say
        // so loudly, and surface a typed error rather than the driver's.
        logger.error(
          { jobId: id, category, code: errorCode(failure) },
          'ingestion failure could not be recorded',
        );
        throw new IngestionFailure('internal_error');
      }
      logger.warn(
        {
          jobId: id,
          correlationId: claimed.request.correlationId,
          stage: claimed.stage,
          category,
          attempt: claimed.attempts,
          durationMs: Math.round(since(started)),
          code: errorCode(error),
        },
        'ingestion run stopped',
      );
      this.measure('stopped', category, since(started));
    }
  }

  private measure(outcome: string, category: FailureCategory | undefined, ms: number): void {
    incrementCounter('ingestion.run.outcome', { outcome, category: category ?? 'none' });
    recordHistogram('ingestion.run.duration_ms', ms, { outcome });
  }

  private async execute(job: Job): Promise<void> {
    const { store, storage, acquirer, extractor } = this.deps;
    let artifact = await store.artifact(job);
    if (artifact === null) {
      const acquisitionStarted = performance.now();
      await store.stage(job, 'acquisition');
      const bytes = await acquirer.acquire(job.request);
      if (bytes.length === 0 || bytes.length > MAX_BYTES)
        throw new IngestionFailure('input_invalid');
      if (this.deps.checksum(bytes) !== job.request.expectedChecksum)
        throw new IngestionFailure('integrity_failed');
      const acquisitionMs = since(acquisitionStarted);
      const storageStarted = performance.now();
      await store.stage(job, 'storage');
      const key = await storage.put(job.request.sourceId, job.request.expectedChecksum, bytes);
      artifact = await store.saveArtifact(job, key, bytes.length, {
        acquisitionMs,
        storageMs: since(storageStarted),
      });
    }

    const extractionStarted = performance.now();
    await store.stage(job, 'extraction');
    // Verify the original survives and is unchanged on every run, including resumption.
    const bytes = await storage.get(job.request.sourceId, artifact.storageKey, artifact.checksum);
    if (bytes.length !== artifact.byteSize || this.deps.checksum(bytes) !== artifact.checksum)
      throw new IngestionFailure('integrity_failed');
    let extraction = await store.extraction(job);
    if (extraction === null) {
      try {
        extraction = await extractor.extract(bytes, job.request.mediaType);
      } catch (error) {
        // An extractor that throws something unclassified failed to extract; that is not an
        // internal fault of ours, and it must not be retried as one.
        throw error instanceof IngestionFailure ? error : new IngestionFailure('extraction_failed');
      }
      this.checkExtraction(extraction);
      await store.saveExtraction(job, artifact, extraction, since(extractionStarted));
    }

    const parsingStarted = performance.now();
    await store.stage(job, 'parsing');
    const parser = this.deps.parsers.find((p) => p.id === job.request.parserId);
    if (parser === undefined) throw new IngestionFailure('parse_failed');
    let parsed: ParsedDocument;
    try {
      parsed = parser.parse(extraction, job.request);
    } catch (error) {
      throw error instanceof IngestionFailure ? error : new IngestionFailure('parse_failed');
    }
    const parsingMs = since(parsingStarted);

    const validationStarted = performance.now();
    await store.stage(job, 'validation');
    validateParsed(extraction.text, parsed);
    await store.submit(job, artifact, extraction, parsed, {
      parsingMs,
      validationMs: since(validationStarted),
    });
  }

  /** What an extractor returned is checked, not trusted: the extractor is an adapter. */
  private checkExtraction(extraction: Extraction): void {
    if (
      !Number.isFinite(extraction.quality) ||
      extraction.quality < 0 ||
      extraction.quality > 1 ||
      extraction.text.length > MAX_TEXT
    )
      throw new IngestionFailure('extraction_failed');
    if (
      codePointLength(extraction.text) < MIN_VISIBLE_CHARACTERS ||
      extraction.quality < MIN_EXTRACTION_QUALITY
    )
      throw new IngestionFailure('extraction_quality_low');
  }
}
