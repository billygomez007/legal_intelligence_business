import { recordPlatformAuditEvent } from '@legalintel/audit';
import { withPublicTransaction, type DbPool, type Tx } from '@legalintel/db';
import {
  corpusStore,
  DocumentId,
  JurisdictionId,
  PassageId,
  SourceId,
  VersionId,
} from '@legalintel/legal-corpus';
import {
  failureCategory,
  FAILURES,
  IngestionFailure,
  MAX_ATTEMPTS,
  PIPELINE_VERSION,
  type Artifact,
  type ArtifactTimings,
  type Extraction,
  type FailureCategory,
  type IngestionRequest,
  type Job,
  type ParsedDocument,
  type Stage,
  type SubmitTimings,
} from '../domain/model';
import { validateParsed } from '../domain/parser';
import type { IngestionStore } from '../ports/store';
import { hash } from './local-storage';
import { currentRights, LOCK_NAMESPACE } from './rights';

interface JobRow {
  id: string;
  request: IngestionRequest;
  pipeline_version: string;
  status: Job['status'];
  stage: Stage;
  attempts: number;
  artifact_id: string | null;
  version_id: string | null;
  failure_category: FailureCategory | null;
}
const mapJob = (r: JobRow): Job => ({
  id: r.id,
  request: r.request,
  pipelineVersion: r.pipeline_version,
  status: r.status,
  stage: r.stage,
  attempts: r.attempts,
  artifactId: r.artifact_id,
  versionId: r.version_id,
  failureCategory: r.failure_category,
});
interface ArtifactRow {
  id: string;
  source_id: string;
  jurisdiction_id: string;
  checksum: string;
  storage_key: string;
  media_type: Artifact['mediaType'];
  byte_size: number;
  acquired_at: Date;
}
const mapArtifact = (r: ArtifactRow): Artifact => ({
  id: r.id,
  sourceId: r.source_id,
  jurisdictionId: r.jurisdiction_id,
  checksum: r.checksum,
  storageKey: r.storage_key,
  mediaType: r.media_type,
  byteSize: r.byte_size,
  acquiredAt: r.acquired_at,
});

async function event(
  tx: Tx,
  job: Job,
  stage: Stage,
  durationMs: number,
  outcome: 'success' | 'error',
  decisionId: string | null,
  failure?: FailureCategory,
): Promise<void> {
  await tx.query(
    `INSERT INTO ingestion.stage_events(job_id,stage,attempt,duration_ms,outcome,rights_decision_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [job.id, stage, job.attempts, Math.max(0, Math.round(durationMs)), outcome, decisionId],
  );
  await recordPlatformAuditEvent(tx, {
    actorKind: 'system',
    action: `ingestion.${outcome === 'error' ? 'processing_failed' : stage + '_completed'}`,
    outcome: failure === 'rights_denied' ? 'denied' : outcome,
    resourceType: 'ingestion_job',
    resourceId: job.id,
    requestId: job.request.correlationId,
    metadata: {
      stage,
      attempt: job.attempts,
      durationMs: Math.max(0, Math.round(durationMs)),
      pipelineVersion: job.pipelineVersion,
      ...(failure === undefined ? {} : { category: failure }),
    },
  });
}

export class PgIngestionStore implements IngestionStore {
  constructor(private readonly pool: DbPool) {}
  async get(id: string): Promise<Job> {
    const r = await this.pool.query<JobRow>('SELECT * FROM ingestion.jobs WHERE id=$1', [id]);
    if (r.rows[0] === undefined) throw new IngestionFailure('input_invalid');
    return mapJob(r.rows[0]);
  }
  async request(input: IngestionRequest): Promise<Job> {
    try {
      return await this.insertRequest(input);
    } catch (error) {
      if (failureCategory(error) === 'rights_denied') await this.auditDeniedRequest(input);
      throw error;
    }
  }
  /** The refused attempt is recorded, by id only, so a probe against a source leaves a trace. */
  private async auditDeniedRequest(input: IngestionRequest): Promise<void> {
    try {
      await withPublicTransaction(this.pool, (tx) =>
        recordPlatformAuditEvent(tx, {
          actorKind: 'user',
          actorId: input.actorId,
          action: 'ingestion.request_denied',
          outcome: 'denied',
          resourceType: 'source',
          resourceId: input.sourceId,
          requestId: input.correlationId,
          metadata: { category: 'rights_denied' },
        }),
      );
    } catch {
      // Recording the refusal must not turn it into a different error.
    }
  }
  private async insertRequest(input: IngestionRequest): Promise<Job> {
    return withPublicTransaction(this.pool, async (tx) => {
      await currentRights(tx, input.sourceId);
      // Correlation identifies the first request, not content identity; retries may use a new trace.
      const digest = hash(JSON.stringify({ ...input, correlationId: undefined }));
      const inserted = await tx.query<JobRow>(
        `INSERT INTO ingestion.jobs(source_id,jurisdiction_id,request,request_checksum,idempotency_key,operation,pipeline_version,actor_id,correlation_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_id,idempotency_key) DO NOTHING RETURNING *`,
        [
          input.sourceId,
          input.jurisdictionId,
          JSON.stringify(input),
          digest,
          input.idempotencyKey,
          input.operation,
          PIPELINE_VERSION,
          input.actorId,
          input.correlationId,
        ],
      );
      if (inserted.rows[0] !== undefined) {
        const job = mapJob(inserted.rows[0]);
        await recordPlatformAuditEvent(tx, {
          actorKind: 'user',
          actorId: input.actorId,
          action: 'ingestion.requested',
          outcome: 'success',
          resourceType: 'ingestion_job',
          resourceId: job.id,
          requestId: input.correlationId,
        });
        return job;
      }
      const prior = await tx.query<JobRow & { request_checksum: string }>(
        'SELECT * FROM ingestion.jobs WHERE source_id=$1 AND idempotency_key=$2',
        [input.sourceId, input.idempotencyKey],
      );
      const row = prior.rows[0];
      // The same key with different content is a caller error, never a silent reuse.
      if (row?.request_checksum !== digest) throw new IngestionFailure('input_invalid');
      return mapJob(row);
    });
  }
  async ready(limit: number): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new IngestionFailure('input_invalid');
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM ingestion.jobs
      WHERE (attempts<$1 AND next_attempt_at<=clock_timestamp()
        AND (status IN ('queued','running') OR (status='failed' AND failure_category IN ('storage_failed','acquisition_failed'))))
        -- A worker that died on the last allowed attempt leaves the job 'running' for good;
        -- surface it so claim() can close it out visibly instead of leaving it stuck.
        OR (status='running' AND attempts>=$1)
      ORDER BY created_at LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );
    return r.rows.map((r) => r.id);
  }
  async withLock<T>(id: string, work: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    let destroy = false;
    try {
      const r = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1,$2)) AS locked',
        [id, LOCK_NAMESPACE.job],
      );
      if (r.rows[0]?.locked !== true) return null;
      try {
        return await work();
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1,$2))', [
            id,
            LOCK_NAMESPACE.job,
          ]);
        } catch {
          destroy = true;
        }
      }
    } finally {
      client.release(destroy);
    }
  }
  async claim(id: string): Promise<Job | null> {
    try {
      const outcome = await this.tryClaim(id);
      if (outcome === 'abandoned') {
        // A worker died on the last allowed attempt. We hold the job's lock, so nobody is
        // running it: close it out visibly rather than leave it 'running' forever.
        await this.closeJob(id, 'internal_error');
        return null;
      }
      return outcome;
    } catch (error) {
      if (failureCategory(error) !== 'rights_denied') throw error;
      // Rights were withdrawn before work began. Without recording it the job would stay
      // queued and be retried, and refused, on every pass forever.
      await this.closeJob(id, 'rights_denied');
      return null;
    }
  }
  private async tryClaim(id: string): Promise<Job | 'abandoned' | null> {
    return withPublicTransaction(this.pool, async (tx) => {
      const result = await tx.query<JobRow>(`SELECT * FROM ingestion.jobs WHERE id=$1 FOR UPDATE`, [
        id,
      ]);
      const row = result.rows[0];
      if (row === undefined) throw new IngestionFailure('input_invalid');
      if (
        row.status === 'pending_review' ||
        row.status === 'needs_review' ||
        (row.status === 'failed' &&
          (row.failure_category === null || FAILURES[row.failure_category] !== 'retryable'))
      )
        return null;
      if (row.pipeline_version !== PIPELINE_VERSION)
        throw new IngestionFailure('validation_failed');
      if (row.attempts >= MAX_ATTEMPTS) return row.status === 'running' ? 'abandoned' : null;
      await currentRights(tx, row.request.sourceId);
      const r = await tx.query<JobRow>(
        `UPDATE ingestion.jobs SET status='running',attempts=attempts+1,failure_category=NULL,failure_summary=NULL
        WHERE id=$1 AND next_attempt_at<=clock_timestamp() RETURNING *`,
        [id],
      );
      return r.rows[0] === undefined ? null : mapJob(r.rows[0]);
    });
  }
  /**
   * Ends a job that will not run: rights withdrawn before it started, or a worker that died on
   * the last allowed attempt. Only a job still eligible to run can be closed this way.
   */
  private async closeJob(id: string, category: 'rights_denied' | 'internal_error'): Promise<void> {
    await withPublicTransaction(this.pool, async (tx) => {
      const r = await tx.query<JobRow>('SELECT * FROM ingestion.jobs WHERE id=$1 FOR UPDATE', [id]);
      const row = r.rows[0];
      if (row === undefined) return;
      const eligible =
        row.status === 'queued' ||
        row.status === 'running' ||
        (row.status === 'failed' &&
          row.failure_category !== null &&
          FAILURES[row.failure_category] === 'retryable');
      if (!eligible) return;
      await tx.query(
        `UPDATE ingestion.jobs SET status='failed',failure_category=$2,failure_summary=$3 WHERE id=$1`,
        [id, category, `Ingestion stopped: ${category}.`],
      );
      await event(tx, mapJob(row), row.stage, 0, 'error', null, category);
    });
  }
  async stage(job: Job, stage: Stage): Promise<void> {
    await withPublicTransaction(this.pool, async (tx) => {
      await currentRights(tx, job.request.sourceId);
      await tx.query('UPDATE ingestion.jobs SET stage=$2 WHERE id=$1', [job.id, stage]);
    });
    job.stage = stage;
  }
  async artifact(job: Job): Promise<Artifact | null> {
    const r = await this.pool.query<ArtifactRow>(
      'SELECT a.* FROM ingestion.artifacts a JOIN ingestion.jobs j ON j.artifact_id=a.id WHERE j.id=$1',
      [job.id],
    );
    return r.rows[0] === undefined ? null : mapArtifact(r.rows[0]);
  }
  async saveArtifact(
    job: Job,
    key: string,
    byteSize: number,
    timings: ArtifactTimings,
  ): Promise<Artifact> {
    return withPublicTransaction(this.pool, async (tx) => {
      const decision = await currentRights(tx, job.request.sourceId);
      await tx.query(
        `INSERT INTO ingestion.artifacts(source_id,jurisdiction_id,checksum,storage_key,media_type,byte_size,input_reference,pipeline_version,rights_decision_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_id,checksum) DO NOTHING`,
        [
          job.request.sourceId,
          job.request.jurisdictionId,
          job.request.expectedChecksum,
          key,
          job.request.mediaType,
          byteSize,
          job.request.inputReference,
          job.pipelineVersion,
          decision,
        ],
      );
      const r = await tx.query<ArtifactRow>(
        'SELECT * FROM ingestion.artifacts WHERE source_id=$1 AND checksum=$2',
        [job.request.sourceId, job.request.expectedChecksum],
      );
      const row = r.rows[0];
      if (row?.byte_size !== byteSize || row.media_type !== job.request.mediaType)
        throw new IngestionFailure('integrity_failed');
      await tx.query(`UPDATE ingestion.jobs SET artifact_id=$2,stage='storage' WHERE id=$1`, [
        job.id,
        row.id,
      ]);
      await event(tx, job, 'acquisition', timings.acquisitionMs, 'success', decision);
      await event(tx, job, 'storage', timings.storageMs, 'success', decision);
      return mapArtifact(row);
    });
  }
  async extraction(job: Job): Promise<Extraction | null> {
    const r = await this.pool.query<{
      text: string;
      extractor_version: string;
      quality: string;
      warnings: string[];
    }>('SELECT * FROM ingestion.extractions WHERE job_id=$1', [job.id]);
    const row = r.rows[0];
    return row === undefined
      ? null
      : {
          text: row.text,
          extractorVersion: row.extractor_version,
          quality: Number(row.quality),
          warnings: row.warnings,
        };
  }
  async saveExtraction(
    job: Job,
    artifact: Artifact,
    extraction: Extraction,
    durationMs: number,
  ): Promise<void> {
    await withPublicTransaction(this.pool, async (tx) => {
      const decision = await currentRights(tx, job.request.sourceId);
      await tx.query(
        `INSERT INTO ingestion.extractions(job_id,artifact_id,extractor_version,text,text_checksum,quality,warnings) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          job.id,
          artifact.id,
          extraction.extractorVersion,
          extraction.text,
          hash(extraction.text),
          extraction.quality,
          extraction.warnings,
        ],
      );
      await event(tx, job, 'extraction', durationMs, 'success', decision);
    });
  }
  async submit(
    job: Job,
    artifact: Artifact,
    extraction: Extraction,
    parsed: ParsedDocument,
    timings: SubmitTimings,
  ): Promise<void> {
    validateParsed(extraction.text, parsed);
    const reviewStarted = performance.now();
    await withPublicTransaction(this.pool, async (tx) => {
      const decision = await currentRights(tx, job.request.sourceId);
      // Serialize identity decisions per jurisdiction/type. This is one bounded transaction,
      // never an external IO lock; no corpus-wide scan or in-memory corpus is required.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
        `${job.request.jurisdictionId}:${job.request.documentType}`,
        LOCK_NAMESPACE.identity,
      ]);
      const identifier = parsed.fields.find((f) => f.field === 'identifier')?.value;
      const title = parsed.fields.find((f) => f.field === 'title')?.value;
      if (title === undefined) throw new IngestionFailure('metadata_invalid');
      const known =
        identifier === undefined
          ? []
          : (
              await tx.query<{ document_id: string }>(
                `SELECT document_id FROM ingestion.identities WHERE source_id=$1 AND document_type=$2 AND identifier=$3`,
                [job.request.sourceId, job.request.documentType, identifier],
              )
            ).rows;
      let documentId = known[0]?.document_id;
      const candidates = await tx.query<{ id: string }>(
        `SELECT DISTINCT d.id FROM corpus.legal_documents d
        LEFT JOIN corpus.document_versions v ON v.document_id=d.id LEFT JOIN ingestion.identities i ON i.document_id=d.id
        WHERE d.jurisdiction_id=$1 AND d.document_type=$2 AND
        ((v.content_checksum=decode($3,'hex') AND v.lifecycle_state<>'rejected') OR ($4::text IS NOT NULL AND i.identifier=$4 AND i.source_id<>$5)
          OR (lower(regexp_replace(d.title,'\\s+',' ','g'))=lower(regexp_replace($6,'\\s+',' ','g')) AND d.id IS DISTINCT FROM $7::uuid)) LIMIT 21`,
        [
          job.request.jurisdictionId,
          job.request.documentType,
          artifact.checksum,
          identifier ?? null,
          job.request.sourceId,
          title,
          documentId ?? null,
        ],
      );
      if (candidates.rows.length > 0) {
        await tx.query(
          `INSERT INTO ingestion.review_tasks(job_id,reason,candidate_document_ids) VALUES($1,'duplicate_detected',$2)`,
          [job.id, candidates.rows.map((r) => r.id)],
        );
        await tx.query(
          `UPDATE ingestion.jobs SET status='needs_review',stage='review',failure_category='duplicate_detected',failure_summary='Ingestion stopped: duplicate_detected.' WHERE id=$1`,
          [job.id],
        );
        await event(tx, job, 'review', performance.now() - reviewStarted, 'success', decision);
        return;
      }
      documentId ??= await corpusStore.createDocument(tx, {
        jurisdictionId: JurisdictionId.parse(job.request.jurisdictionId),
        documentType: job.request.documentType,
        title,
      });
      if (identifier !== undefined)
        await tx.query(
          `INSERT INTO ingestion.identities(source_id,document_type,identifier,document_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [job.request.sourceId, job.request.documentType, identifier, documentId],
        );
      const next = await tx.query<{ n: number }>(
        'SELECT coalesce(max(version_number),0)+1 AS n FROM corpus.document_versions WHERE document_id=$1',
        [documentId],
      );
      const versionId = await corpusStore.createVersion(tx, {
        documentId: DocumentId.parse(documentId),
        jurisdictionId: JurisdictionId.parse(job.request.jurisdictionId),
        sourceId: SourceId.parse(job.request.sourceId),
        sourceReference: job.request.inputReference,
        versionNumber: next.rows[0]?.n ?? 1,
        acquiredAt: artifact.acquiredAt,
        contentChecksum: Buffer.from(artifact.checksum, 'hex'),
        storageKey: artifact.storageKey,
        pipelineVersion: job.pipelineVersion,
      });
      await tx.query(
        `INSERT INTO ingestion.version_evidence(version_id,job_id,artifact_id,parser_version,fields,concepts,warnings) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          versionId,
          job.id,
          artifact.id,
          job.request.parserId,
          JSON.stringify(parsed.fields),
          JSON.stringify(parsed.concepts),
          [...extraction.warnings, ...parsed.warnings],
        ],
      );
      const passageIds = new Map<number, string>();
      for (let start = 0; start < parsed.passages.length; start += 100) {
        const batch = parsed.passages.slice(start, start + 100);
        const inserted = await tx.query<{ id: string; ordinal: number }>(
          `INSERT INTO corpus.passages(version_id,ordinal,locator,text,text_sha256,extraction_confidence)
          SELECT $1,x.ordinal,x.locator,x.text,sha256(convert_to(x.text,'UTF8')),$3 FROM jsonb_to_recordset($2::jsonb) AS x(ordinal integer,locator text,text text) RETURNING id,ordinal`,
          [versionId, JSON.stringify(batch), extraction.quality],
        );
        for (const row of inserted.rows) passageIds.set(row.ordinal, row.id);
        const evidence = batch.map((p) => ({
          passage_id: passageIds.get(p.ordinal),
          stable_key: hash(
            JSON.stringify([artifact.checksum, job.request.parserId, p.ordinal, p.locator, p.text]),
          ),
          start_offset: p.start,
          end_offset: p.end,
        }));
        await tx.query(
          `INSERT INTO ingestion.passage_evidence(passage_id,version_id,stable_key,start_offset,end_offset)
          SELECT x.passage_id,$1,x.stable_key,x.start_offset,x.end_offset FROM jsonb_to_recordset($2::jsonb) AS x(passage_id uuid,stable_key text,start_offset integer,end_offset integer)`,
          [versionId, JSON.stringify(evidence)],
        );
      }
      // One graph edge per authority per passage (the corpus enforces it). A repeated mention
      // of the same authority shares that edge; a different spelling of it stays an unlinked
      // candidate rather than being merged by guesswork.
      const linked = new Map<string, { graphId: string; quote: string }>();
      for (const c of parsed.citations) {
        const passageId = passageIds.get(c.passageOrdinal);
        if (passageId === undefined) throw new IngestionFailure('validation_failed');
        const target = await tx.query<{ document_id: string }>(
          `SELECT document_id FROM ingestion.identities WHERE source_id=$1 AND identifier=$2`,
          [job.request.sourceId, c.identifier],
        );
        // Resolved only within this source, only when unambiguous, and never to the document
        // itself. Anything else stays an unresolved candidate for a person to look at.
        const only = target.rows.length === 1 ? target.rows[0]?.document_id : undefined;
        const targetId = only === documentId ? undefined : only;
        let graphId: string | null = null;
        if (targetId !== undefined) {
          const key = `${c.passageOrdinal}:${targetId}`;
          const existing = linked.get(key);
          if (existing === undefined) {
            graphId = await corpusStore.addCitation(tx, {
              fromVersionId: versionId,
              toDocumentId: DocumentId.parse(targetId),
              relationshipType: 'cites',
              citationText: c.quote,
              evidencePassageId: PassageId.parse(passageId),
              origin: 'machine',
              confidence: c.confidence,
            });
            linked.set(key, { graphId, quote: c.quote });
          } else if (existing.quote === c.quote) {
            graphId = existing.graphId;
          }
        }
        await tx.query(
          `INSERT INTO ingestion.citation_candidates(version_id,passage_id,identifier,quote,start_offset,end_offset,confidence,target_document_id,graph_citation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            versionId,
            passageId,
            c.identifier,
            c.quote,
            c.start,
            c.end,
            c.confidence,
            graphId === null ? null : (targetId ?? null),
            graphId,
          ],
        );
      }
      await event(tx, job, 'parsing', timings.parsingMs, 'success', decision);
      await event(tx, job, 'validation', timings.validationMs, 'success', decision);
      await tx.query(
        `INSERT INTO ingestion.review_tasks(job_id,version_id,reason) VALUES($1,$2,'validation_complete')`,
        [job.id, versionId],
      );
      await corpusStore.submitForReview(tx, VersionId.parse(versionId));
      await tx.query(
        `UPDATE ingestion.jobs SET version_id=$2,status='pending_review',stage='review' WHERE id=$1`,
        [job.id, versionId],
      );
      // The corpus will not approve or publish a version until its provenance is attested. This
      // checked database function is the only writer of that record, and it takes every value
      // from the evidence the hand-off gate has just verified, so it cannot be made to attest
      // something ingestion did not check. A job that ends awaiting review without it fails here.
      await tx.query('SELECT ingestion.attest_provenance($1)', [job.id]);
      await event(tx, job, 'review', performance.now() - reviewStarted, 'success', decision);
    });
  }
  async fail(job: Job, category: FailureCategory, durationMs: number): Promise<void> {
    await withPublicTransaction(this.pool, async (tx) => {
      const status = FAILURES[category] === 'review' ? 'needs_review' : 'failed';
      if (status === 'needs_review')
        await tx.query(
          'INSERT INTO ingestion.review_tasks(job_id,reason) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [job.id, category],
        );
      await tx.query(
        `UPDATE ingestion.jobs SET status=$2,failure_category=$3,failure_summary=$4,next_attempt_at=clock_timestamp()+make_interval(secs=>attempts*5) WHERE id=$1`,
        [job.id, status, category, `Ingestion stopped: ${category}.`],
      );
      await event(tx, job, job.stage, durationMs, 'error', null, category);
    });
  }
}
