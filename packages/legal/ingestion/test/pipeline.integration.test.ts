import { randomUUID } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { corpusStore, VersionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BasicTextExtractor,
  createIngestionPipeline,
  createIngestionReview,
  hash,
  IngestionPipeline,
  PgIngestionStore,
  type Extraction,
  type MediaType,
} from '../src';
import { createHarness, syntheticDocument, unique, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

const count = async (sql: string, params: readonly unknown[] = []): Promise<number> =>
  Number((await h.q<{ n: string }>(sql, params))[0]?.n ?? -1);

describe('the pipeline, end to end, on synthetic documents', () => {
  it('takes a synthetic act from request to pending human review, and stops there', async () => {
    const w = await h.world();
    const content = syntheticDocument(unique('End to end Act'), { identifier: unique('SYN/E2E') });
    const job = await h.ingestDocument(w, content);

    expect(job).toMatchObject({
      status: 'pending_review',
      stage: 'review',
      failureCategory: null,
      attempts: 1,
    });
    const versionId = job.versionId ?? '';
    expect(versionId).not.toBe('');

    // The corpus holds a draft awaiting a person. Nothing is approved or published.
    const [version] = await h.q<{
      lifecycle_state: string;
      published_at: Date | null;
      approved_by: string | null;
      source_id: string;
      jurisdiction_id: string;
      pipeline_version: string;
      storage_key: string;
      checksum: string;
    }>(
      `SELECT lifecycle_state, published_at, approved_by, source_id, jurisdiction_id, pipeline_version,
              storage_key, encode(content_checksum, 'hex') AS checksum
         FROM corpus.document_versions WHERE id = $1`,
      [versionId],
    );
    expect(version).toMatchObject({
      lifecycle_state: 'pending_review',
      published_at: null,
      approved_by: null,
      source_id: w.sourceId,
      jurisdiction_id: w.jurisdictionId,
      pipeline_version: 'ingestion/1',
    });

    // Provenance: the version names the exact bytes it came from, and those bytes are kept.
    expect(version?.checksum).toBe(hash(content));
    const kept = await h.storage().get(w.sourceId, version?.storage_key ?? '', hash(content));
    expect(Buffer.from(kept).toString('utf8')).toBe(content);

    // Passages are the source's lines, each hashed by the database.
    const passages = await h.q<{ ordinal: number; text: string; sha: string }>(
      `SELECT ordinal, text, encode(text_sha256, 'hex') AS sha
         FROM corpus.passages WHERE version_id = $1 ORDER BY ordinal`,
      [versionId],
    );
    expect(passages.map((p) => p.text)).toEqual(content.split('\n').filter((l) => l !== ''));
    for (const passage of passages) expect(passage.sha).toBe(hash(passage.text));

    // Metadata is evidence, marked as unreviewed parser output.
    const [evidence] = await h.q<{
      fields: { field: string; origin: string; reviewState: string; quote: string }[];
      warnings: string[];
    }>('SELECT fields, warnings FROM ingestion.version_evidence WHERE version_id = $1', [
      versionId,
    ]);
    expect(evidence?.fields.map((f) => f.field).sort()).toEqual(['identifier', 'title']);
    for (const field of evidence?.fields ?? []) {
      expect(field.origin).toBe('parser');
      expect(field.reviewState).toBe('unreviewed');
    }
    expect(evidence?.warnings).toContain('metadata_requires_human_review');

    // A stage record per stage, each naming the rights decision it relied on.
    const events = await h.q<{
      stage: string;
      attempt: number;
      outcome: string;
      rights_decision_id: string | null;
      duration_ms: number;
    }>(
      `SELECT stage, attempt, outcome, rights_decision_id, duration_ms
         FROM ingestion.stage_events WHERE job_id = $1 ORDER BY id`,
      [job.id],
    );
    expect(events.map((e) => e.stage)).toEqual([
      'acquisition',
      'storage',
      'extraction',
      'parsing',
      'validation',
      'review',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ attempt: 1, outcome: 'success' });
      expect(event.rights_decision_id).not.toBeNull();
      expect(Number.isInteger(event.duration_ms)).toBe(true);
    }

    // Auditing carries identifiers and outcomes, never content.
    const audit = await h.q<{ action: string; outcome: string; metadata: unknown }>(
      "SELECT action, outcome, metadata FROM audit.platform_events WHERE resource_id = $1 AND resource_type = 'ingestion_job'",
      [job.id],
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'ingestion.requested',
        'ingestion.acquisition_completed',
        'ingestion.extraction_completed',
        'ingestion.review_completed',
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain('fictional');

    // End users cannot see it.
    expect(
      await h.asApp((tx) => corpusStore.getVersion(tx, VersionId.parse(versionId))),
    ).toBeNull();
  });

  it('never publishes: approval is a person, and publication is another act with its own rights', async () => {
    const w = await h.world();
    const job = await h.ingestDocument(w, syntheticDocument(unique('Approval Act')));
    const versionId = VersionId.parse(job.versionId ?? '');
    const taskId = await h.taskFor(job.id);

    await h.verifyCritical(taskId); // a person verifies the publish-critical metadata first
    await h.review().decide(h.reviewer(), {
      taskId,
      decision: 'approve',
      reasonCode: 'checked_against_source',
    });
    const [approved] = await h.q<{
      lifecycle_state: string;
      approved_by: string;
      published_at: Date | null;
    }>(
      'SELECT lifecycle_state, approved_by, published_at FROM corpus.document_versions WHERE id = $1',
      [versionId],
    );
    expect(approved).toMatchObject({
      lifecycle_state: 'approved',
      approved_by: h.staff.reviewer,
      published_at: null,
    });
    expect(await h.asApp((tx) => corpusStore.getVersion(tx, versionId))).toBeNull();

    // Permission to acquire and structure a source is not permission to show it.
    await expect(
      h.asDataops((tx) => corpusStore.publishVersion(tx, versionId, h.staff.publisher)),
    ).rejects.toMatchObject({ code: 'corpus.rights_not_cleared' });

    await h.grant(w.sourceId, 'approved', [
      'acquire_store',
      'derive_metadata',
      'display',
      'index_search',
    ]);
    await h.asDataops((tx) => corpusStore.publishVersion(tx, versionId, h.staff.publisher));
    expect(await h.asApp((tx) => corpusStore.getVersion(tx, versionId))).toMatchObject({
      lifecycleState: 'published',
    });
  });

  it('cannot approve or publish its own work, whatever the pipeline asks', async () => {
    const w = await h.world();
    const job = await h.ingestDocument(w, syntheticDocument(unique('Own work Act')));
    for (const sql of [
      "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
      "UPDATE corpus.document_versions SET lifecycle_state = 'published', published_by = $2 WHERE id = $1",
    ]) {
      await expect(
        h.asIngest((tx) => tx.query(sql, [job.versionId, h.staff.reviewer])),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('the rights gate is checked per operation and fails closed', () => {
  const cases: {
    name: string;
    arrange: (h: Harness) => Promise<Awaited<ReturnType<Harness['world']>>>;
  }[] = [
    { name: 'no decision at all', arrange: (x) => x.world(null) },
    {
      name: 'a denial',
      arrange: async (x) => {
        const w = await x.world(null);
        await x.grant(w.sourceId, 'denied', []);
        return w;
      },
    },
    {
      name: 'an approval that was later revoked',
      arrange: async (x) => {
        const w = await x.world();
        await x.revoke(w.sourceId);
        return w;
      },
    },
    {
      name: 'an approval that has expired',
      arrange: async (x) => {
        const w = await x.world(null);
        await x.grant(w.sourceId, 'approved', ['acquire_store', 'derive_metadata'], {
          effectiveFrom: new Date(Date.now() - 2 * 3_600_000),
          expiresAt: new Date(Date.now() - 3_600_000),
        });
        return w;
      },
    },
    {
      name: 'an approval that has not taken effect yet',
      arrange: async (x) => {
        const w = await x.world(null);
        await x.grant(w.sourceId, 'approved', ['acquire_store', 'derive_metadata'], {
          effectiveFrom: new Date(Date.now() + 3_600_000),
        });
        return w;
      },
    },
    {
      name: 'display and search rights only',
      arrange: (x) => x.world(['display', 'index_search']),
    },
    { name: 'storage rights but not metadata rights', arrange: (x) => x.world(['acquire_store']) },
    {
      name: 'metadata rights but not storage rights',
      arrange: (x) => x.world(['derive_metadata']),
    },
    { name: 'AI processing rights only', arrange: (x) => x.world(['ai_processing']) },
  ];

  for (const c of cases) {
    it(`refuses a request when the source has ${c.name}, leaves a trace and creates nothing`, async () => {
      const w = await c.arrange(h);
      await expect(
        h.pipeline().request(h.operator(), h.prepare(w, syntheticDocument(unique('Refused')))),
      ).rejects.toMatchObject({ category: 'rights_denied' });

      expect(
        await count('SELECT count(*) AS n FROM ingestion.jobs WHERE source_id = $1', [w.sourceId]),
      ).toBe(0);
      expect(
        await count(
          "SELECT count(*) AS n FROM audit.platform_events WHERE action = 'ingestion.request_denied' AND resource_id = $1 AND outcome = 'denied'",
          [w.sourceId],
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(readdirSync(h.objects).filter((f) => f.includes(w.sourceId))).toEqual([]);
    });
  }

  it('lets the latest decision govern: revoked, then approved again, is allowed', async () => {
    const w = await h.world();
    await h.revoke(w.sourceId);
    await h.grant(w.sourceId, 'approved', ['acquire_store', 'derive_metadata']);
    const job = await h.ingestDocument(w, syntheticDocument(unique('Reinstated')));
    expect(job.status).toBe('pending_review');
  });

  it('ends a queued job whose rights were withdrawn before it started, visibly and for good', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const requested = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Withdrawn'))),
    );
    await h.revoke(w.sourceId);

    const after = await p.run(requested.id);
    expect(after).toMatchObject({
      status: 'failed',
      failureCategory: 'rights_denied',
      attempts: 0,
    });

    // It left the queue: a worker will not be handed it, and refused, on every pass forever.
    expect(await h.store().ready(100)).not.toContain(requested.id);
    expect(await p.run(requested.id)).toMatchObject({
      status: 'failed',
      failureCategory: 'rights_denied',
    });

    // Nothing was acquired or kept.
    expect(
      await count('SELECT count(*) AS n FROM ingestion.artifacts WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(0);
    expect(readdirSync(h.objects).filter((f) => f.includes(w.sourceId))).toEqual([]);

    const [row] = await h.q<{ failure_summary: string }>(
      'SELECT failure_summary FROM ingestion.jobs WHERE id = $1',
      [requested.id],
    );
    expect(row?.failure_summary).toBe('Ingestion stopped: rights_denied.');
    expect(
      await count(
        "SELECT count(*) AS n FROM audit.platform_events WHERE resource_id = $1 AND outcome = 'denied' AND metadata->>'category' = 'rights_denied'",
        [requested.id],
      ),
    ).toBe(1);
  });

  it('stops a run when rights are withdrawn in the middle of it, before anything more is derived', async () => {
    const w = await h.world();
    const revokingExtractor = {
      async extract(bytes: Uint8Array, mediaType: MediaType): Promise<Extraction> {
        await h.revoke(w.sourceId);
        return new BasicTextExtractor().extract(bytes, mediaType);
      },
    };
    const p = h.pipeline({ extractor: revokingExtractor });
    const requested = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Mid-run'))),
    );
    const after = await p.run(requested.id);

    expect(after).toMatchObject({
      status: 'failed',
      failureCategory: 'rights_denied',
      versionId: null,
    });
    expect(
      await count('SELECT count(*) AS n FROM ingestion.extractions WHERE job_id = $1', [
        requested.id,
      ]),
    ).toBe(0);
    expect(
      await count('SELECT count(*) AS n FROM corpus.legal_documents WHERE jurisdiction_id = $1', [
        w.jurisdictionId,
      ]),
    ).toBe(0);
    expect(
      await count('SELECT count(*) AS n FROM corpus.document_versions WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(0);
  });
});

describe('idempotency, retry and concurrency', () => {
  it('returns the same job for the same key and request, and refuses the same key for other content', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const request = h.prepare(w, syntheticDocument(unique('Idempotent')), { key: unique('idem') });
    const first = await p.request(h.operator(), request);
    const again = await p.request(h.operator(), { ...request, correlationId: randomUUID() });
    expect(again.id).toBe(first.id);

    await expect(
      p.request(h.operator(), { ...request, expectedChecksum: hash('some other content') }),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    expect(
      await count('SELECT count(*) AS n FROM ingestion.jobs WHERE source_id = $1', [w.sourceId]),
    ).toBe(1);
  });

  it('does nothing when a finished job is run again', async () => {
    const w = await h.world();
    const job = await h.ingestDocument(w, syntheticDocument(unique('Finished')));
    const again = await h.pipeline().run(job.id);
    expect(again).toMatchObject({
      status: 'pending_review',
      attempts: 1,
      versionId: job.versionId,
    });
    expect(
      await count('SELECT count(*) AS n FROM corpus.document_versions WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(1);
  });

  it('produces one result when two workers run the same job at once', async () => {
    const w = await h.world();
    const first = h.pipeline();
    const second = h.pipeline();
    const requested = await first.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Race'))),
    );
    await Promise.all([first.run(requested.id), second.run(requested.id)]);

    expect(await h.store().get(requested.id)).toMatchObject({
      status: 'pending_review',
      attempts: 1,
    });
    expect(
      await count('SELECT count(*) AS n FROM corpus.document_versions WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(1);
  });

  it('serialises two different documents that claim the same identity into one document with two versions', async () => {
    const w = await h.world();
    const identifier = unique('SYN/SAME');
    const title = unique('Same identity');
    const a = syntheticDocument(title, { identifier, extra: ['2. First fictional variant.'] });
    const b = syntheticDocument(title, { identifier, extra: ['2. Second fictional variant.'] });
    const p1 = h.pipeline();
    const p2 = h.pipeline();
    const [ja, jb] = await Promise.all([
      p1.request(h.operator(), h.prepare(w, a)),
      p2.request(h.operator(), h.prepare(w, b)),
    ]);
    await Promise.all([p1.run(ja.id), p2.run(jb.id)]);

    expect(
      await count('SELECT count(*) AS n FROM corpus.legal_documents WHERE jurisdiction_id = $1', [
        w.jurisdictionId,
      ]),
    ).toBe(1);
    const versions = await h.q<{ version_number: number }>(
      'SELECT version_number FROM corpus.document_versions WHERE jurisdiction_id = $1 ORDER BY version_number',
      [w.jurisdictionId],
    );
    expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
  });

  it('treats a source that is not ready as retryable, and succeeds once it is', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const content = syntheticDocument(unique('Not ready'));
    const request = h.prepare(w, content, { provision: false });
    const requested = await p.request(h.operator(), request);

    const first = await p.run(requested.id);
    expect(first).toMatchObject({
      status: 'failed',
      failureCategory: 'acquisition_failed',
      attempts: 1,
    });
    // Backoff: it is not offered again immediately.
    expect(await h.store().ready(100)).not.toContain(requested.id);

    writeFileSync(join(h.inbox, `${request.sourceId}-${request.inputReference}`), content, {
      mode: 0o600,
    });
    await h.expireBackoff(requested.id);
    expect(await h.store().ready(100)).toContain(requested.id);

    expect(await p.run(requested.id)).toMatchObject({ status: 'pending_review', attempts: 2 });
  });

  it('retries a transient database fault and resumes without redoing what is already done', async () => {
    class FlakyStore extends PgIngestionStore {
      failures = 1;
      override async submit(...args: Parameters<PgIngestionStore['submit']>): Promise<void> {
        if (this.failures > 0) {
          this.failures -= 1;
          throw Object.assign(new Error('simulated serialization failure with secret detail'), {
            code: '40001',
          });
        }
        await super.submit(...args);
      }
    }
    const w = await h.world();
    const p = new IngestionPipeline({
      ...h.dependencies(),
      store: new FlakyStore(h.ingest),
      assertSafe: () => Promise.resolve(),
      checksum: hash,
    });
    const requested = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Flaky'))),
    );

    const first = await p.run(requested.id);
    expect(first).toMatchObject({
      status: 'failed',
      failureCategory: 'storage_failed',
      attempts: 1,
    });
    // The failure text the driver produced never reaches the record.
    const [row] = await h.q<{ failure_summary: string }>(
      'SELECT failure_summary FROM ingestion.jobs WHERE id = $1',
      [requested.id],
    );
    expect(row?.failure_summary).toBe('Ingestion stopped: storage_failed.');
    expect(h.logs.join('')).not.toContain('secret detail');

    await h.expireBackoff(requested.id);
    const second = await p.run(requested.id);
    expect(second).toMatchObject({ status: 'pending_review', attempts: 2 });
    expect(
      await count('SELECT count(*) AS n FROM ingestion.extractions WHERE job_id = $1', [
        requested.id,
      ]),
    ).toBe(1);
    expect(
      await count('SELECT count(*) AS n FROM ingestion.artifacts WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(1);
    expect(
      await count('SELECT count(*) AS n FROM corpus.document_versions WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(1);
  });

  it('gives up after the maximum number of attempts and says so', async () => {
    class BrokenStore extends PgIngestionStore {
      override submit(): Promise<void> {
        return Promise.reject(Object.assign(new Error('simulated outage'), { code: '08006' }));
      }
    }
    const w = await h.world();
    const p = new IngestionPipeline({
      ...h.dependencies(),
      store: new BrokenStore(h.ingest),
      assertSafe: () => Promise.resolve(),
      checksum: hash,
    });
    const requested = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Outage'))),
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await p.run(requested.id)).toMatchObject({
        status: 'failed',
        failureCategory: 'storage_failed',
        attempts: attempt,
      });
      await h.expireBackoff(requested.id);
    }
    expect(await h.store().ready(100)).not.toContain(requested.id);
    expect(await p.run(requested.id)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('closes out a job abandoned by a worker that died on its last attempt', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const requested = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Abandoned'))),
    );
    const store = h.store();
    for (let i = 0; i < 3; i += 1) await store.claim(requested.id);
    expect(await store.get(requested.id)).toMatchObject({ status: 'running', attempts: 3 });
    expect(await store.ready(100)).toContain(requested.id);

    expect(await p.run(requested.id)).toMatchObject({
      status: 'failed',
      failureCategory: 'internal_error',
    });
    expect(await store.ready(100)).not.toContain(requested.id);
  });

  it('treats a checksum mismatch as a terminal integrity failure and keeps nothing', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const request = {
      ...h.prepare(w, syntheticDocument(unique('Tampered'))),
      expectedChecksum: hash('bytes that are not the provisioned bytes'),
    };
    const requested = await p.request(h.operator(), request);
    expect(await p.run(requested.id)).toMatchObject({
      status: 'failed',
      failureCategory: 'integrity_failed',
      attempts: 1,
    });
    expect(
      await count('SELECT count(*) AS n FROM ingestion.artifacts WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(0);
    expect(readdirSync(h.objects).filter((f) => f.includes(w.sourceId))).toEqual([]);
    expect(await h.store().ready(100)).not.toContain(requested.id);
    expect(await p.run(requested.id)).toMatchObject({ attempts: 1 });
  });
});

describe('every failure ends in a typed outcome a person can act on', () => {
  const cases: {
    name: string;
    content: () => string | Uint8Array;
    mediaType?: MediaType;
    status: 'needs_review' | 'failed';
    category: string;
  }[] = [
    {
      name: 'a PDF (unsupported until an isolated extractor exists)',
      content: () => '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
      mediaType: 'application/pdf',
      status: 'needs_review',
      category: 'unsupported_format',
    },
    {
      name: 'bytes that are not UTF-8',
      content: () => new Uint8Array([0x54, 0xff, 0xfe, 0x80, 0x00, 0x81, 0x54, 0x54]),
      status: 'failed',
      category: 'extraction_failed',
    },
    {
      name: 'text with almost nothing in it',
      content: () => '...... ,,,,,, ;;;;;; !!!!!! ??????',
      status: 'needs_review',
      category: 'extraction_quality_low',
    },
    {
      name: 'a line too long to be a passage',
      content: () => `Title: SYNTHETIC ${unique('Long')}\n${'x'.repeat(8001)}`,
      status: 'needs_review',
      category: 'parse_failed',
    },
    {
      name: 'a document with no title',
      content: () => '1. A fictional provision with no title anywhere in the document.',
      status: 'needs_review',
      category: 'metadata_invalid',
    },
    {
      name: 'a document that gives its title twice',
      content: () =>
        `Title: SYNTHETIC one\nTitle: SYNTHETIC two\n1. A fictional provision of some length.`,
      status: 'needs_review',
      category: 'metadata_invalid',
    },
  ];

  for (const c of cases) {
    it(`classifies ${c.name} as ${c.category}, keeps the original, and creates no version`, async () => {
      const w = await h.world();
      const content = c.content();
      const job = await h.ingestDocument(
        w,
        content,
        c.mediaType === undefined ? {} : { mediaType: c.mediaType },
      );
      expect(job).toMatchObject({ status: c.status, failureCategory: c.category, versionId: null });

      const [row] = await h.q<{ failure_summary: string }>(
        'SELECT failure_summary FROM ingestion.jobs WHERE id = $1',
        [job.id],
      );
      expect(row?.failure_summary).toBe(`Ingestion stopped: ${c.category}.`);

      // The raw artifact is preserved even though nothing could be made of it.
      const [artifact] = await h.q<{ storage_key: string; checksum: string }>(
        'SELECT storage_key, checksum FROM ingestion.artifacts WHERE source_id = $1',
        [w.sourceId],
      );
      expect(artifact?.checksum).toBe(hash(content));
      await expect(
        h.storage().get(w.sourceId, artifact?.storage_key ?? '', hash(content)),
      ).resolves.toBeDefined();

      expect(
        await count('SELECT count(*) AS n FROM corpus.document_versions WHERE source_id = $1', [
          w.sourceId,
        ]),
      ).toBe(0);
      const tasks = await h.q<{ reason: string }>(
        'SELECT reason FROM ingestion.review_tasks WHERE job_id = $1',
        [job.id],
      );
      expect(tasks.map((t) => t.reason)).toEqual(c.status === 'needs_review' ? [c.category] : []);
    });
  }

  it('refuses a request that names a parser nobody registered', async () => {
    const w = await h.world();
    const request = {
      ...h.prepare(w, syntheticDocument(unique('No parser'))),
      parserId: 'made-up-parser',
    };
    await expect(h.pipeline().request(h.operator(), request)).rejects.toMatchObject({
      category: 'input_invalid',
    });
  });

  it('refuses a request from anyone who is not the acting staff user, or that carries a tenant', async () => {
    const w = await h.world();
    const request = h.prepare(w, syntheticDocument(unique('Wrong actor')));
    const p = h.pipeline();
    await expect(
      p.request(h.operator(), { ...request, actorId: h.staff.reviewer }),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    await expect(
      p.request(h.operator(), { ...request, organizationId: randomUUID() }),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    await expect(
      p.request({ ...h.operator(), organizationId: randomUUID() as never }, request),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    await expect(
      p.request({ ...h.operator(), principal: { kind: 'system', name: 'cron' } }, request),
    ).rejects.toMatchObject({ category: 'input_invalid' });
  });

  it('refuses a request from staff who lack the permission', async () => {
    const w = await h.world();
    await expect(
      h.pipeline().request(h.reviewer(), {
        ...h.prepare(w, syntheticDocument(unique('No permission'))),
        actorId: h.staff.reviewer,
      }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('duplicates go to a person, never to a silent merge', () => {
  it('sends the same bytes ingested twice to review instead of creating a second version', async () => {
    const w = await h.world();
    const content = syntheticDocument(unique('Duplicate'), { identifier: unique('SYN/DUP') });
    const first = await h.ingestDocument(w, content);
    const second = await h.ingestDocument(w, content);

    expect(first.status).toBe('pending_review');
    expect(second).toMatchObject({
      status: 'needs_review',
      failureCategory: 'duplicate_detected',
      versionId: null,
    });
    expect(
      await count('SELECT count(*) AS n FROM corpus.document_versions WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(1);

    const [task] = await h.q<{ reason: string; candidate_document_ids: string[] }>(
      'SELECT reason, candidate_document_ids FROM ingestion.review_tasks WHERE job_id = $1',
      [second.id],
    );
    expect(task?.reason).toBe('duplicate_detected');
    expect(task?.candidate_document_ids).toHaveLength(1);

    // A person can decline it. Nobody can approve a duplicate into existence.
    const taskId = await h.taskFor(second.id);
    await expect(
      h.review().decide(h.reviewer(), { taskId, decision: 'approve', reasonCode: 'looks_fine' }),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    await h
      .review()
      .decide(h.reviewer(), { taskId, decision: 'reject', reasonCode: 'confirmed_duplicate' });
  });

  it('notices the same content arriving from a different source in the same jurisdiction', async () => {
    const w = await h.world();
    const other = await h.secondSource(w);
    const content = syntheticDocument(unique('Two sources'), { identifier: unique('SYN/TWO') });
    await h.ingestDocument(w, content);
    const again = await h.ingestDocument(w, content, { sourceId: other });
    expect(again).toMatchObject({ status: 'needs_review', failureCategory: 'duplicate_detected' });
  });

  it('notices the same title under a different identifier', async () => {
    const w = await h.world();
    const title = unique('Shared title');
    await h.ingestDocument(
      w,
      syntheticDocument(title, { identifier: unique('SYN/A'), extra: ['2. First variant.'] }),
    );
    const second = await h.ingestDocument(
      w,
      syntheticDocument(title, { identifier: unique('SYN/B'), extra: ['2. Second variant.'] }),
    );
    expect(second).toMatchObject({ status: 'needs_review', failureCategory: 'duplicate_detected' });
  });

  it('adds a new version to a known document instead of calling it a duplicate', async () => {
    const w = await h.world();
    const title = unique('Versioned');
    const identifier = unique('SYN/VER');
    const first = await h.ingestDocument(w, syntheticDocument(title, { identifier }));
    const second = await h.ingestDocument(
      w,
      syntheticDocument(title, { identifier, extra: ['2. An added fictional provision.'] }),
    );
    expect(first.status).toBe('pending_review');
    expect(second.status).toBe('pending_review');

    const versions = await h.q<{ document_id: string; version_number: number }>(
      'SELECT document_id, version_number FROM corpus.document_versions WHERE jurisdiction_id = $1 ORDER BY version_number',
      [w.jurisdictionId],
    );
    expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
    expect(new Set(versions.map((v) => v.document_id)).size).toBe(1);
  });
});

describe('citations are evidence in the citing document and nothing more', () => {
  it('links a citation only to an authority this source has already identified', async () => {
    const w = await h.world();
    const other = await h.secondSource(w);
    const cited = unique('SYN/CITED');
    const own = unique('SYN/CITING');
    const citedJob = await h.ingestDocument(
      w,
      syntheticDocument(unique('Cited'), { identifier: cited }),
    );
    const [citedVersion] = await h.q<{ document_id: string }>(
      'SELECT document_id FROM corpus.document_versions WHERE id = $1',
      [citedJob.versionId],
    );

    const citing = syntheticDocument(unique('Citing'), {
      identifier: own,
      extra: [
        `2. As provided elsewhere. Cites: ${cited} and again Cites: ${cited}`,
        `3. A reference nobody has ingested. Cites: SYN/UNKNOWN/${unique('x')}`,
        `4. A document that names itself. Cites: ${own}`,
      ],
    });
    const job = await h.ingestDocument(w, citing);
    expect(job.status).toBe('pending_review');

    const candidates = await h.q<{
      identifier: string;
      target_document_id: string | null;
      graph_citation_id: string | null;
    }>(
      `SELECT c.identifier, c.target_document_id, c.graph_citation_id
         FROM ingestion.citation_candidates c JOIN corpus.passages p ON p.id = c.passage_id
        WHERE c.version_id = $1 ORDER BY p.ordinal, c.start_offset`,
      [job.versionId],
    );
    expect(candidates).toHaveLength(4);
    const [first, repeat, unknown, self] = candidates;
    expect(first?.target_document_id).toBe(citedVersion?.document_id);
    expect(first?.graph_citation_id).not.toBeNull();
    // The same authority mentioned twice in one passage shares one edge.
    expect(repeat?.graph_citation_id).toBe(first?.graph_citation_id);
    // Unknown and self references are recorded as candidates and linked to nothing.
    expect(unknown).toMatchObject({ target_document_id: null, graph_citation_id: null });
    expect(self).toMatchObject({ target_document_id: null, graph_citation_id: null });

    const edges = await h.q<{
      relationship_type: string;
      origin: string;
      review_status: string;
      to_document_id: string;
      version_id: string;
    }>(
      `SELECT c.relationship_type, c.origin, c.review_status, c.to_document_id, p.version_id
         FROM graph.citations c JOIN corpus.passages p ON p.id = c.evidence_passage_id
        WHERE c.from_version_id = $1`,
      [job.versionId],
    );
    expect(edges).toEqual([
      {
        relationship_type: 'cites',
        origin: 'machine',
        review_status: 'unreviewed',
        to_document_id: citedVersion?.document_id,
        version_id: job.versionId,
      },
    ]);

    // A different source's identifiers are not trusted to mean the same authority.
    const foreign = await h.ingestDocument(
      w,
      syntheticDocument(unique('Foreign citing'), {
        identifier: unique('SYN/FOREIGN'),
        extra: [`2. Cites: ${cited}`],
      }),
      { sourceId: other },
    );
    const [foreignCandidate] = await h.q<{ target_document_id: string | null }>(
      'SELECT target_document_id FROM ingestion.citation_candidates WHERE version_id = $1',
      [foreign.versionId],
    );
    expect(foreignCandidate?.target_document_id).toBeNull();
  });
});

describe('operational safety', () => {
  it('refuses to run in production while synthetic authorities exist', async () => {
    const w = await h.world();
    const production = createIngestionPipeline({
      pool: h.ingest,
      environment: 'production',
      ...h.dependencies(),
    });
    await expect(
      production.request(h.operator(), h.prepare(w, syntheticDocument(unique('Production')))),
    ).rejects.toMatchObject({ code: 'corpus.synthetic_in_production' });
  });

  it('refuses to run over a connection that is not the ingestion role', async () => {
    const w = await h.world();
    const wrong = createIngestionPipeline({
      pool: h.dataops,
      environment: 'test',
      ...h.dependencies(),
    });
    await expect(
      wrong.request(h.operator(), h.prepare(w, syntheticDocument(unique('Wrong role')))),
    ).rejects.toThrow(/requires the legalintel_ingest database role/);

    const wrongReview = createIngestionReview({ pool: h.ingest, environment: 'test' });
    await expect(wrongReview.queue(h.reviewer())).rejects.toThrow(
      /requires the legalintel_dataops database role/,
    );
  });

  it('runs the ready queue oldest first and returns each job as it stands', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const a = await p.request(h.operator(), h.prepare(w, syntheticDocument(unique('Queue A'))));
    const b = await p.request(h.operator(), h.prepare(w, syntheticDocument(unique('Queue B'))));
    const ready = await h.store().ready(100);
    expect(ready.indexOf(a.id)).toBeLessThan(ready.indexOf(b.id));
    const jobs = await p.runReady(100);
    expect(jobs.filter((j) => [a.id, b.id].includes(j.id)).map((j) => j.status)).toEqual([
      'pending_review',
      'pending_review',
    ]);
  });

  it('never logged document text, connection details or raw driver messages', () => {
    const written = h.logs.join('\n');
    expect(written.length).toBeGreaterThan(0);
    expect(written).not.toContain('fictional');
    expect(written).not.toContain('NOT REAL LAW');
    expect(written).not.toMatch(/postgres(ql)?:\/\//);
    expect(written).not.toContain('password');
    expect(written).toContain('ingestion run completed');
    for (const line of h.logs) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed['jobId'] === 'string') expect(parsed['jobId']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
