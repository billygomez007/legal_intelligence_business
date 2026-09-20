import { randomUUID } from 'node:crypto';

import { checkGuardrails, formatViolations } from '@legalintel/db/testing';
import { corpusStore, VersionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hash, labelledParser, type Artifact, type Extraction, type Job } from '../src';
import { createHarness, syntheticDocument, unique, type Harness, type World } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

const count = async (sql: string, params: readonly unknown[] = []): Promise<number> =>
  Number((await h.q<{ n: string }>(sql, params))[0]?.n ?? -1);

/**
 * A job driven by hand through the real store up to (and including) extraction, plus a corpus
 * draft, so a test can present the database with evidence the pipeline itself would never
 * write and see whether the database refuses it. Every negative test ends with the same insert
 * succeeding when the evidence is right, so a refusal is about the evidence and not the setup.
 */
async function handRolled(
  w: World,
  title = unique('Hand rolled'),
  options: { extract?: boolean } = {},
) {
  const content = syntheticDocument(title, { identifier: unique('SYN/HAND') });
  const request = h.prepare(w, content);
  const requested = await h.pipeline().request(h.operator(), request);
  const store = h.store();
  const claimed = await store.claim(requested.id);
  if (claimed === null) throw new Error('the job could not be claimed');
  const job: Job = claimed;
  const bytes = Buffer.from(content, 'utf8');
  const key = await h.storage().put(w.sourceId, request.expectedChecksum, bytes);
  const artifact: Artifact = await store.saveArtifact(job, key, bytes.length, {
    acquisitionMs: 1,
    storageMs: 1,
  });
  const extraction: Extraction = {
    text: content,
    extractorVersion: 'test',
    quality: 1,
    warnings: [],
  };
  if (options.extract !== false) await store.saveExtraction(job, artifact, extraction, 1);
  const parsed = labelledParser.parse(extraction, request);

  const { documentId, versionId } = await h.asIngest(async (tx) => {
    const documentId = await corpusStore.createDocument(tx, {
      jurisdictionId: w.jurisdictionId,
      documentType: 'legislation',
      title,
    });
    const versionId = await corpusStore.createVersion(tx, {
      documentId,
      jurisdictionId: w.jurisdictionId,
      versionNumber: 1,
      sourceId: w.sourceId,
      acquiredAt: artifact.acquiredAt,
      contentChecksum: Buffer.from(artifact.checksum, 'hex'),
      storageKey: artifact.storageKey,
      pipelineVersion: job.pipelineVersion,
    });
    return { documentId, versionId };
  });

  const insertEvidence = (fields: unknown, concepts: unknown = []) =>
    h.asIngest((tx) =>
      tx.query(
        `INSERT INTO ingestion.version_evidence(version_id, job_id, artifact_id, parser_version, fields, concepts, warnings)
         VALUES ($1, $2, $3, 'labelled-v1', $4, $5, '{}')`,
        [versionId, job.id, artifact.id, JSON.stringify(fields), JSON.stringify(concepts)],
      ),
    );

  return { w, job, artifact, extraction, parsed, documentId, versionId, insertEvidence };
}

describe('the database refuses evidence the pipeline would never write', () => {
  type Field = Record<string, unknown>;
  const bad: { name: string; mutate: (fields: Field[]) => void; message: RegExp }[] = [
    {
      name: 'metadata claiming to be verified',
      mutate: (f) => {
        if (f[0]) f[0]['reviewState'] = 'verified';
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'metadata claiming a human reviewed it',
      mutate: (f) => {
        if (f[0]) f[0]['reviewState'] = 'human_verified';
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'metadata with no review state at all',
      mutate: (f) => {
        if (f[0]) delete f[0]['reviewState'];
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'metadata with no confidence',
      mutate: (f) => {
        if (f[0]) delete f[0]['confidence'];
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'metadata with an impossible confidence',
      mutate: (f) => {
        if (f[0]) f[0]['confidence'] = 2;
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'metadata of an origin nobody defined',
      mutate: (f) => {
        if (f[0]) f[0]['origin'] = 'human';
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'metadata with no start position',
      mutate: (f) => {
        if (f[0]) delete f[0]['start'];
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'a quote that is not the text at its stated position',
      mutate: (f) => {
        if (f[0]) f[0]['start'] = Number(f[0]['start']) + 1;
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'a value that differs from its quote',
      mutate: (f) => {
        if (f[0]) f[0]['value'] = 'something the document does not say';
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'an end position before the start',
      mutate: (f) => {
        if (f[0]) f[0]['end'] = Number(f[0]['start']);
      },
      message: /invalid metadata evidence/,
    },
    {
      name: 'no title at all',
      mutate: (f) => {
        f.splice(0, f.length, ...f.filter((field) => field['field'] !== 'title'));
      },
      message: /missing title evidence/,
    },
  ];

  it('rejects malformed, unverifiable or self-promoting metadata, then accepts the same evidence when correct', async () => {
    const hand = await handRolled(await h.world());
    for (const c of bad) {
      const fields = structuredClone(hand.parsed.fields) as unknown as Field[];
      c.mutate(fields);
      await expect(hand.insertEvidence(fields), c.name).rejects.toThrow(c.message);
    }
    // Control: the unmodified evidence is accepted, so each refusal above was about the evidence.
    await hand.insertEvidence(hand.parsed.fields);
    expect(
      await count('SELECT count(*) AS n FROM ingestion.version_evidence WHERE version_id = $1', [
        hand.versionId,
      ]),
    ).toBe(1);
  });

  it('verifies in the database that the stored text is the text that was hashed', async () => {
    const hand = await handRolled(await h.world(), undefined, { extract: false });
    const insert = (checksum: string) =>
      h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.extractions(job_id, artifact_id, extractor_version, text, text_checksum, quality, warnings)
           VALUES ($1, $2, 'test', $3, $4, 1, '{}')`,
          [hand.job.id, hand.artifact.id, hand.extraction.text, checksum],
        ),
      );
    await expect(insert(hash('some other text'))).rejects.toMatchObject({ code: '23514' });
    await expect(insert('not-a-checksum')).rejects.toMatchObject({ code: '23514' });
    await insert(hash(hand.extraction.text));
  });

  it('rejects a version whose provenance does not match the artifact it claims to come from', async () => {
    const w = await h.world();
    const hand = await handRolled(w);
    const other = await h.asIngest(async (tx) => {
      const documentId = await corpusStore.createDocument(tx, {
        jurisdictionId: w.jurisdictionId,
        documentType: 'legislation',
        title: unique('Other'),
      });
      return corpusStore.createVersion(tx, {
        documentId,
        jurisdictionId: w.jurisdictionId,
        versionNumber: 1,
        sourceId: w.sourceId,
        acquiredAt: hand.artifact.acquiredAt,
        contentChecksum: Buffer.from(hash('different bytes'), 'hex'),
        storageKey: hand.artifact.storageKey,
        pipelineVersion: hand.job.pipelineVersion,
      });
    });
    await expect(
      h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.version_evidence(version_id, job_id, artifact_id, parser_version, fields, warnings)
           VALUES ($1, $2, $3, 'labelled-v1', $4, '{}')`,
          [other, hand.job.id, hand.artifact.id, JSON.stringify(hand.parsed.fields)],
        ),
      ),
    ).rejects.toThrow(/version provenance mismatch/);
  });

  it('holds passage and citation evidence to the exact text it points at', async () => {
    const hand = await handRolled(await h.world());
    await hand.insertEvidence(hand.parsed.fields);
    await h.asIngest((tx) =>
      corpusStore.addPassages(
        tx,
        hand.versionId,
        hand.parsed.passages.map((p) => ({ ordinal: p.ordinal, locator: p.locator, text: p.text })),
      ),
    );
    const passages = await h.q<{ id: string; ordinal: number }>(
      'SELECT id, ordinal FROM corpus.passages WHERE version_id = $1 ORDER BY ordinal',
      [hand.versionId],
    );
    const first = passages[0];
    const segment = hand.parsed.passages[0];
    if (first === undefined || segment === undefined) throw new Error('no passages');

    const insert = (start: number, end: number) =>
      h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.passage_evidence(passage_id, version_id, stable_key, start_offset, end_offset)
           VALUES ($1, $2, $3, $4, $5)`,
          [first.id, hand.versionId, hash(`${start}:${end}`), start, end],
        ),
      );
    await expect(insert(segment.start + 1, segment.end + 1)).rejects.toThrow(
      /passage extraction mismatch/,
    );
    await expect(insert(segment.start, segment.end + 3)).rejects.toThrow(
      /passage extraction mismatch/,
    );
    await insert(segment.start, segment.end);

    const citation = (quote: string, start: number, end: number) =>
      h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.citation_candidates(version_id, passage_id, identifier, quote, start_offset, end_offset, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [hand.versionId, first.id, quote, quote, start, end],
        ),
      );
    await expect(citation('Title', 3, 8)).rejects.toThrow(/citation evidence mismatch/);
    await citation(segment.text.slice(0, 5), 0, 5);
  });

  it('refuses to record an artifact against a rights decision that is no longer the one in force', async () => {
    const w = await h.world();
    const [first] = await h.q<{ id: string }>(
      'SELECT id FROM corpus.source_rights_decisions WHERE source_id = $1',
      [w.sourceId],
    );
    await h.grant(w.sourceId, 'approved', ['acquire_store', 'derive_metadata', 'display']);
    const checksum = hash(unique('artifact'));
    await expect(
      h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.artifacts(source_id, jurisdiction_id, checksum, storage_key, media_type, byte_size, input_reference, pipeline_version, rights_decision_id)
           VALUES ($1, $2, $3, $4, 'text/plain', 10, $5, 'ingestion/1', $6)`,
          [
            w.sourceId,
            w.jurisdictionId,
            checksum,
            `corpus-${w.sourceId}-${checksum}`,
            randomUUID(),
            first?.id,
          ],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'ingestion.stale_rights_evidence' });
  });
});

describe('a job cannot claim a result it has not earned', () => {
  it('refuses the hand-off until evidence, a review task and every passage record are in place', async () => {
    const hand = await handRolled(await h.world());
    await hand.insertEvidence(hand.parsed.fields);
    await h.asIngest(async (tx) => {
      await corpusStore.addPassages(
        tx,
        hand.versionId,
        hand.parsed.passages.map((p) => ({ ordinal: p.ordinal, locator: p.locator, text: p.text })),
      );
      await corpusStore.submitForReview(tx, hand.versionId);
    });
    const handOff = () =>
      h.asIngest((tx) =>
        tx.query(
          "UPDATE ingestion.jobs SET version_id = $2, status = 'pending_review', stage = 'review' WHERE id = $1",
          [hand.job.id, hand.versionId],
        ),
      );

    // No review task yet.
    await expect(handOff()).rejects.toMatchObject({ hint: 'ingestion.unvalidated_handoff' });

    await h.asIngest((tx) =>
      tx.query(
        "INSERT INTO ingestion.review_tasks(job_id, version_id, reason) VALUES ($1, $2, 'validation_complete')",
        [hand.job.id, hand.versionId],
      ),
    );
    // A task, but no passage has any evidence yet.
    await expect(handOff()).rejects.toMatchObject({ hint: 'ingestion.unvalidated_handoff' });

    const passages = await h.q<{ id: string; ordinal: number }>(
      'SELECT id, ordinal FROM corpus.passages WHERE version_id = $1 ORDER BY ordinal',
      [hand.versionId],
    );
    // Evidence for all but the last passage is still not enough.
    const evidenceFor = async (index: number) => {
      const passage = passages[index];
      const segment = hand.parsed.passages[index];
      if (passage === undefined || segment === undefined) throw new Error('missing passage');
      await h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.passage_evidence(passage_id, version_id, stable_key, start_offset, end_offset)
           VALUES ($1, $2, $3, $4, $5)`,
          [passage.id, hand.versionId, hash(`${index}`), segment.start, segment.end],
        ),
      );
    };
    for (let i = 0; i < passages.length - 1; i += 1) await evidenceFor(i);
    await expect(handOff()).rejects.toMatchObject({ hint: 'ingestion.unvalidated_handoff' });

    await evidenceFor(passages.length - 1);
    // Every record is in place, but a job cannot END awaiting review without its provenance
    // attestation (checked when the transaction commits, so it cannot be forgotten).
    await expect(handOff()).rejects.toMatchObject({ hint: 'ingestion.attestation_missing' });
    expect(await h.store().get(hand.job.id)).not.toMatchObject({ status: 'pending_review' });

    // The pipeline hands off and attests in one transaction.
    await h.asIngest(async (tx) => {
      await tx.query(
        "UPDATE ingestion.jobs SET version_id = $2, status = 'pending_review', stage = 'review' WHERE id = $1",
        [hand.job.id, hand.versionId],
      );
      await tx.query('SELECT ingestion.attest_provenance($1)', [hand.job.id]);
    });
    expect(await h.store().get(hand.job.id)).toMatchObject({ status: 'pending_review' });
  });

  it('refuses to hand a version with no passages to review at all', async () => {
    const hand = await handRolled(await h.world());
    await hand.insertEvidence(hand.parsed.fields);
    await expect(
      h.asIngest((tx) => corpusStore.submitForReview(tx, hand.versionId)),
    ).rejects.toMatchObject({ code: 'corpus.review_not_ready' });
  });

  it('refuses to create a job that carries a tenant, a storage location, another actor or a forced state', async () => {
    const w = await h.world();
    const base = (): Record<string, unknown> => ({
      sourceId: w.sourceId,
      jurisdictionId: w.jurisdictionId,
      operation: 'structure',
      inputReference: randomUUID(),
      expectedChecksum: hash('x'),
      mediaType: 'text/plain',
      parserId: 'labelled-v1',
      documentType: 'legislation',
      idempotencyKey: unique('direct'),
      actorId: h.staff.operator,
      correlationId: randomUUID(),
    });
    const insert = (request: Record<string, unknown>, status = 'queued') =>
      h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.jobs(source_id, jurisdiction_id, request, request_checksum, idempotency_key, operation, pipeline_version, actor_id, correlation_id, status)
           VALUES ($1, $2, $3, $4, $5, 'structure', 'ingestion/1', $6, $7, $8)`,
          [
            w.sourceId,
            w.jurisdictionId,
            JSON.stringify(request),
            hash(JSON.stringify(request)),
            String(request['idempotencyKey']),
            h.staff.operator,
            request['correlationId'],
            status,
          ],
        ),
      );

    await expect(insert({ ...base(), organizationId: randomUUID() })).rejects.toThrow(
      /invalid request scope/,
    );
    await expect(insert({ ...base(), storageKey: 'corpus-x' })).rejects.toThrow(
      /invalid request scope/,
    );
    await expect(insert({ ...base(), actorId: h.staff.reviewer })).rejects.toThrow(
      /invalid request scope/,
    );
    await expect(insert({ ...base(), sourceId: randomUUID() })).rejects.toThrow(
      /invalid request scope/,
    );
    await expect(insert(base(), 'pending_review')).rejects.toThrow(
      /invalid initial job state|violates check/,
    );
    await insert(base());
  });

  it('keeps every record append-only and a settled job settled, even against a superuser', async () => {
    const w = await h.world();
    const job = await h.ingestDocument(w, syntheticDocument(unique('Settled')));
    const statements: [string, unknown[]][] = [
      ['UPDATE ingestion.artifacts SET byte_size = 1 WHERE source_id = $1', [w.sourceId]],
      ['DELETE FROM ingestion.artifacts WHERE source_id = $1', [w.sourceId]],
      ['UPDATE ingestion.extractions SET quality = 0.1 WHERE job_id = $1', [job.id]],
      ['DELETE FROM ingestion.version_evidence WHERE job_id = $1', [job.id]],
      ["UPDATE ingestion.stage_events SET outcome = 'error' WHERE job_id = $1", [job.id]],
      ['DELETE FROM ingestion.review_tasks WHERE job_id = $1', [job.id]],
    ];
    for (const [sql, params] of statements) {
      await expect(
        h.database.withAdmin((c) => c.query(sql, params)),
        sql,
      ).rejects.toMatchObject({ hint: 'corpus.append_only' });
    }
    await expect(
      h.database.withAdmin((c) => c.query('TRUNCATE ingestion.passage_evidence')),
    ).rejects.toMatchObject({ hint: 'corpus.append_only' });
    await expect(
      h.database.withAdmin((c) => c.query('DELETE FROM ingestion.jobs WHERE id = $1', [job.id])),
    ).rejects.toMatchObject({ hint: 'corpus.append_only' });
    await expect(
      h.database.withAdmin((c) =>
        c.query("UPDATE ingestion.jobs SET status = 'queued' WHERE id = $1", [job.id]),
      ),
    ).rejects.toThrow(/job is terminal/);
    await expect(
      h.database.withAdmin((c) =>
        c.query('UPDATE ingestion.jobs SET source_id = $2 WHERE id = $1', [job.id, randomUUID()]),
      ),
    ).rejects.toThrow(/job identity is immutable/);
  });

  it('cannot be edited by the application role, or read by it', async () => {
    await expect(
      h.asApp((tx) => tx.query('SELECT count(*) FROM ingestion.jobs')),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      h.asApp((tx) => tx.query('SELECT count(*) FROM ingestion.review_tasks')),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      h.asApp((tx) => tx.query('SELECT ingestion.current_rights($1)', [randomUUID()])),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('provenance is attested only from evidence ingestion has verified', () => {
  /** A job driven to the hand-off gate, with the transaction left for the test to finish. */
  async function readyForHandOff() {
    const hand = await handRolled(await h.world());
    await hand.insertEvidence(hand.parsed.fields);
    await h.asIngest(async (tx) => {
      await corpusStore.addPassages(
        tx,
        hand.versionId,
        hand.parsed.passages.map((p) => ({ ordinal: p.ordinal, locator: p.locator, text: p.text })),
      );
      await corpusStore.submitForReview(tx, hand.versionId);
      await tx.query(
        "INSERT INTO ingestion.review_tasks(job_id, version_id, reason) VALUES ($1, $2, 'validation_complete')",
        [hand.job.id, hand.versionId],
      );
    });
    const passages = await h.q<{ id: string; ordinal: number }>(
      'SELECT id, ordinal FROM corpus.passages WHERE version_id = $1 ORDER BY ordinal',
      [hand.versionId],
    );
    for (const passage of passages) {
      const segment = hand.parsed.passages[passage.ordinal];
      if (segment === undefined) throw new Error('missing passage');
      await h.asIngest((tx) =>
        tx.query(
          `INSERT INTO ingestion.passage_evidence(passage_id, version_id, stable_key, start_offset, end_offset)
           VALUES ($1, $2, $3, $4, $5)`,
          [passage.id, hand.versionId, hash(`${passage.ordinal}`), segment.start, segment.end],
        ),
      );
    }
    const handOff = (tx: Parameters<Parameters<Harness['asIngest']>[0]>[0]) =>
      tx.query(
        "UPDATE ingestion.jobs SET version_id = $2, status = 'pending_review', stage = 'review' WHERE id = $1",
        [hand.job.id, hand.versionId],
      );
    return { hand, handOff };
  }
  const attestation = (versionId: string) =>
    h.q('SELECT * FROM corpus.version_provenance_attestations WHERE version_id = $1', [versionId]);

  it('refuses a job that has not passed the hand-off gate: queued, running, failed or needing review', async () => {
    const w = await h.world();
    const p = h.pipeline();
    const queued = await p.request(h.operator(), h.prepare(w, syntheticDocument(unique('Queued'))));
    const claimed = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Running'))),
    );
    await h.store().claim(claimed.id);
    const failed = await p.request(
      h.operator(),
      h.prepare(w, syntheticDocument(unique('Failed')), { provision: false }),
    );
    await p.run(failed.id); // the bytes are not there: a retryable failure
    const needsReview = await h.ingestDocument(w, 'not a supported format', {
      mediaType: 'application/pdf',
    });
    for (const id of [queued.id, claimed.id, failed.id, needsReview.id]) {
      await expect(
        h.asIngest((tx) => tx.query('SELECT ingestion.attest_provenance($1)', [id])),
      ).rejects.toMatchObject({ hint: 'ingestion.attestation_not_ready' });
    }
    await expect(
      h.asIngest((tx) => tx.query('SELECT ingestion.attest_provenance($1)', [randomUUID()])),
    ).rejects.toMatchObject({ hint: 'ingestion.attestation_not_ready' });
  });

  it('re-checks that the rights allowing this processing hold now, not only at hand-off', async () => {
    const { hand, handOff } = await readyForHandOff();
    await expect(
      h.asIngest(async (tx) => {
        await handOff(tx);
        // Rights are withdrawn (and committed) after the hand-off gate passed, before it attests.
        await h.revoke(hand.w.sourceId);
        await tx.query('SELECT ingestion.attest_provenance($1)', [hand.job.id]);
      }),
    ).rejects.toMatchObject({ hint: 'corpus.rights_denied' });
    expect(await attestation(hand.versionId)).toHaveLength(0);
    expect(await h.store().get(hand.job.id)).not.toMatchObject({ status: 'pending_review' });
  });

  it('is idempotent: attesting twice returns the same record and writes one', async () => {
    const { hand, handOff } = await readyForHandOff();
    const ids = await h.asIngest(async (tx) => {
      await handOff(tx);
      const first = await tx.query<{ id: string }>('SELECT ingestion.attest_provenance($1) AS id', [
        hand.job.id,
      ]);
      const second = await tx.query<{ id: string }>(
        'SELECT ingestion.attest_provenance($1) AS id',
        [hand.job.id],
      );
      return [first.rows[0]?.id, second.rows[0]?.id];
    });
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBe(ids[0]);
    expect(await attestation(hand.versionId)).toHaveLength(1);
  });

  it('cannot be forged: no runtime role can write an attestation, whatever it claims', async () => {
    const hand = await handRolled(await h.world());
    for (const pool of [h.asIngest, h.asDataops, h.asApp]) {
      await expect(
        pool((tx) =>
          tx.query(
            `INSERT INTO corpus.version_provenance_attestations
               (version_id, source_id, content_checksum, pipeline_version, attestation_type,
                attestation_version, evidence_reference, system_identity)
             SELECT id, source_id, content_checksum, pipeline_version, 'ingestion_pipeline', 1,
                    'FABRICATED', 'ingestion-pipeline'
               FROM corpus.document_versions WHERE id = $1`,
            [hand.versionId],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    // And the function is the ingest role's alone.
    for (const pool of [h.asDataops, h.asApp]) {
      await expect(
        pool((tx) => tx.query('SELECT ingestion.attest_provenance($1)', [hand.job.id])),
      ).rejects.toMatchObject({ code: '42501' });
    }
    expect(await attestation(hand.versionId)).toHaveLength(0);
  });

  it('leaves a version the pipeline did not hand off unable to be approved: the corpus asks for the attestation', async () => {
    // A version created and submitted by hand, as a compromised writer might: it has passages and
    // is awaiting review, but nothing attested where it came from.
    const hand = await handRolled(await h.world());
    await hand.insertEvidence(hand.parsed.fields);
    await h.asIngest(async (tx) => {
      await corpusStore.addPassages(
        tx,
        hand.versionId,
        hand.parsed.passages.map((p) => ({ ordinal: p.ordinal, locator: p.locator, text: p.text })),
      );
      await corpusStore.submitForReview(tx, hand.versionId);
    });
    await expect(
      h.asDataops((tx) => corpusStore.approveVersion(tx, hand.versionId, h.staff.reviewer)),
    ).rejects.toMatchObject({ code: 'corpus.provenance_required' });
  });
});

describe('review is a person deciding, recorded in the corpus and in ingestion', () => {
  const pendingJob = async (title = unique('Review')) => {
    const w = await h.world();
    const job = await h.ingestDocument(
      w,
      syntheticDocument(title, { identifier: unique('SYN/REV') }),
    );
    expect(job.status).toBe('pending_review');
    return {
      w,
      job,
      taskId: await h.taskFor(job.id),
      versionId: VersionId.parse(job.versionId ?? ''),
    };
  };
  const decide = async (
    taskId: string,
    decision: 'approve' | 'reject' | 'hold',
    reasonCode = 'checked',
  ) => {
    // Approval needs the publish-critical metadata verified by a person (corpus 0004).
    if (decision === 'approve') await h.verifyCritical(taskId);
    return h.review().decide(h.reviewer(), { taskId, decision, reasonCode });
  };

  it('is not open to staff who were not given the permission', async () => {
    const { taskId } = await pendingJob();
    for (const context of [h.operator(), h.publisher()]) {
      await expect(
        h.review().decide(context, { taskId, decision: 'approve', reasonCode: 'checked' }),
      ).rejects.toMatchObject({ kind: 'forbidden' });
    }
    await expect(h.review().queue(h.operator())).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(h.review().packet(h.publisher(), taskId)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    // And it is only for staff with no tenant.
    await expect(
      h
        .review()
        .decide(
          { ...h.reviewer(), organizationId: randomUUID() as never },
          { taskId, decision: 'hold', reasonCode: 'x' },
        ),
    ).rejects.toMatchObject({ category: 'input_invalid' });
  });

  it('refuses malformed decisions, including free text where a reason code belongs', async () => {
    const { taskId } = await pendingJob();
    for (const input of [
      { taskId, decision: 'publish', reasonCode: 'x' },
      { taskId, decision: 'approve', reasonCode: 'This looks fine to me!' },
      { taskId: 'not-a-uuid', decision: 'approve', reasonCode: 'x' },
      { taskId, decision: 'approve', reasonCode: 'x', extra: 1 },
    ]) {
      await expect(h.review().decide(h.reviewer(), input)).rejects.toMatchObject({
        category: 'input_invalid',
      });
    }
  });

  it('approves in the corpus and in ingestion together, audited by identifier, and does not publish', async () => {
    const { w, taskId, versionId } = await pendingJob();
    await decide(taskId, 'approve', 'verified_against_source');

    const [decision] = await h.q<{
      decision: string;
      actor_id: string;
      corpus_decision: string;
      corpus_actor: string;
      corpus_version: string;
    }>(
      `SELECT d.decision, d.actor_id, c.decision AS corpus_decision, c.decided_by AS corpus_actor, c.version_id AS corpus_version
         FROM ingestion.review_decisions d JOIN corpus.version_review_decisions c ON c.id = d.corpus_decision_id
        WHERE d.task_id = $1`,
      [taskId],
    );
    expect(decision).toMatchObject({
      decision: 'approve',
      actor_id: h.staff.reviewer,
      corpus_decision: 'approve',
      corpus_actor: h.staff.reviewer,
      corpus_version: versionId,
    });
    expect(
      await count(
        "SELECT count(*) AS n FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'approved' AND published_at IS NULL",
        [versionId],
      ),
    ).toBe(1);

    const audit = await h.q<{ actor_id: string; metadata: Record<string, unknown> }>(
      "SELECT actor_id, metadata FROM audit.platform_events WHERE action = 'ingestion.review_decided' AND resource_id = $1",
      [taskId],
    );
    expect(audit).toEqual([
      {
        actor_id: h.staff.reviewer,
        metadata: { decision: 'approve', reasonCode: 'verified_against_source' },
      },
    ]);
    // The source's rights are unchanged: reviewing did not touch them.
    expect(
      await count('SELECT count(*) AS n FROM corpus.source_rights_decisions WHERE source_id = $1', [
        w.sourceId,
      ]),
    ).toBe(1);
  });

  it('closes a task with the first approval or rejection and refuses any further decision', async () => {
    const { taskId } = await pendingJob();
    await decide(taskId, 'approve');
    for (const again of ['approve', 'reject', 'hold'] as const) {
      await expect(decide(taskId, again)).rejects.toMatchObject({ category: 'input_invalid' });
    }
    expect(
      await count('SELECT count(*) AS n FROM ingestion.review_decisions WHERE task_id = $1', [
        taskId,
      ]),
    ).toBe(1);
  });

  it('keeps a held task open and its version awaiting review, then lets a later decision close it', async () => {
    const { taskId, versionId } = await pendingJob();
    await decide(taskId, 'hold', 'needs_second_look');
    expect(
      await count(
        "SELECT count(*) AS n FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'pending_review'",
        [versionId],
      ),
    ).toBe(1);
    expect((await h.review().queue(h.reviewer(), 100)).map((t) => t.id)).toContain(taskId);

    await decide(taskId, 'approve', 'second_look_done');
    expect((await h.review().queue(h.reviewer(), 100)).map((t) => t.id)).not.toContain(taskId);
    expect(
      await count(
        "SELECT count(*) AS n FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'approved'",
        [versionId],
      ),
    ).toBe(1);
  });

  it('lets a rejection stand, and lets the same bytes be ingested again afterwards', async () => {
    const title = unique('Rejected then retried');
    const identifier = unique('SYN/RETRY');
    const content = syntheticDocument(title, { identifier });
    const w = await h.world();
    const first = await h.ingestDocument(w, content);
    await decide(await h.taskFor(first.id), 'reject', 'parser_misread_title');
    expect(
      await count(
        "SELECT count(*) AS n FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'rejected'",
        [first.versionId],
      ),
    ).toBe(1);

    const again = await h.ingestDocument(w, content);
    expect(again).toMatchObject({ status: 'pending_review', failureCategory: null });
    const versions = await h.q<{ version_number: number; lifecycle_state: string }>(
      'SELECT version_number, lifecycle_state FROM corpus.document_versions WHERE jurisdiction_id = $1 ORDER BY version_number',
      [w.jurisdictionId],
    );
    expect(versions).toEqual([
      { version_number: 1, lifecycle_state: 'rejected' },
      { version_number: 2, lifecycle_state: 'pending_review' },
    ]);
  });

  it('will not approve once the rights have been withdrawn, but still lets a person reject', async () => {
    const { w, taskId, versionId } = await pendingJob();
    await h.revoke(w.sourceId);
    await expect(decide(taskId, 'approve')).rejects.toMatchObject({ category: 'rights_denied' });
    expect(
      await count(
        "SELECT count(*) AS n FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'pending_review'",
        [versionId],
      ),
    ).toBe(1);
    expect(
      await count('SELECT count(*) AS n FROM ingestion.review_decisions WHERE task_id = $1', [
        taskId,
      ]),
    ).toBe(0);
    expect(
      await count(
        'SELECT count(*) AS n FROM corpus.version_review_decisions WHERE version_id = $1',
        [versionId],
      ),
    ).toBe(0);

    await decide(taskId, 'reject', 'rights_withdrawn');
    expect(
      await count(
        "SELECT count(*) AS n FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'rejected'",
        [versionId],
      ),
    ).toBe(1);
  });

  it('shows a reviewer everything needed to decide, and says whether processing is still allowed', async () => {
    const { w, taskId } = await pendingJob();
    const before = await h.review().packet(h.reviewer(), taskId);
    expect(Object.keys(before).sort()).toEqual(
      [
        'artifact',
        'citations',
        'criticalMetadata',
        'currentProcessingAllowed',
        'decisions',
        'extraction',
        'job',
        'metadata',
        'passages',
        'rightsEvidence',
        'source',
        'task',
      ].sort(),
    );
    expect(before['currentProcessingAllowed']).toBe(true);
    expect(before['rightsEvidence']).toBe('SYNTHETIC-EVIDENCE');
    expect((before['passages'] as unknown[]).length).toBeGreaterThan(0);
    // The reviewer is shown what a person must verify, with the fingerprint to quote.
    const critical = before['criticalMetadata'] as {
      field: string;
      blocking: boolean;
      valueSha256: string;
    }[];
    expect(critical.map((row) => row.field).sort()).toEqual([
      'instrument_number',
      'jurisdiction',
      'title',
    ]);
    expect(
      critical
        .filter((row) => row.blocking)
        .map((row) => row.field)
        .sort(),
    ).toEqual(['jurisdiction', 'title']);
    expect(critical.find((row) => row.field === 'title')?.valueSha256).toMatch(/^[a-f0-9]{64}$/);

    await h.revoke(w.sourceId);
    expect((await h.review().packet(h.reviewer(), taskId))['currentProcessingAllowed']).toBe(false);
  });

  it('cannot be short-circuited in the database: approval needs the corpus decision, and the two records must agree', async () => {
    const { versionId, taskId } = await pendingJob();
    const insert = (decision: string, corpusDecisionId: string | null) =>
      h.asDataops((tx) =>
        tx.query(
          `INSERT INTO ingestion.review_decisions(task_id, decision, actor_id, reason_code, corpus_decision_id)
           VALUES ($1, $2, $3, 'direct', $4)`,
          [taskId, decision, h.staff.reviewer, corpusDecisionId],
        ),
      );
    // No corpus decision.
    await expect(insert('approve', null)).rejects.toMatchObject({
      hint: 'ingestion.corpus_decision_required',
    });
    // A corpus decision that says something else.
    const held = await h.asDataops((tx) =>
      corpusStore.recordReviewDecision(tx, {
        versionId,
        decision: 'hold',
        reasonCode: 'held',
        decidedBy: h.staff.reviewer,
      }),
    );
    await expect(insert('approve', held)).rejects.toMatchObject({
      hint: 'ingestion.corpus_decision_required',
    });
    // The version's state must match too: an approve decision without the transition is refused.
    const approved = await h.asDataops((tx) =>
      corpusStore.recordReviewDecision(tx, {
        versionId,
        decision: 'approve',
        reasonCode: 'x',
        decidedBy: h.staff.reviewer,
      }),
    );
    await expect(insert('approve', approved)).rejects.toThrow(
      /version state does not match the decision/,
    );
    // Nobody can approve the version directly either, without its decision (corpus gate).
    await expect(
      h.asDataops((tx) =>
        tx.query(
          "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
          [versionId, h.staff.publisher],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'corpus.review_decision_required' });
  });
});

describe('private organisation material has no path into the public corpus', () => {
  it('has no tenant column and no reference to a tenant table anywhere in the public-corpus schemas', async () => {
    const columns = await h.q<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.columns
        WHERE table_schema IN ('ingestion', 'corpus', 'graph') AND column_name = 'organization_id'`,
    );
    expect(columns).toEqual([]);

    const references = await h.q<{ to_table: string }>(
      `SELECT DISTINCT confrelid::regclass::text AS to_table
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f' AND n.nspname IN ('ingestion', 'corpus', 'graph')`,
    );
    for (const { to_table } of references) {
      // The only thing outside these schemas they may point at is a person (a reviewer).
      expect(
        to_table.startsWith('ingestion.') ||
          to_table.startsWith('corpus.') ||
          to_table.startsWith('graph.') ||
          to_table === 'iam.users',
        to_table,
      ).toBe(true);
    }
  });

  it('cannot describe a source as user-supplied, in the database or in the code', async () => {
    const [definition] = await h.q<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'sources_kind_check'",
    );
    expect(definition?.definition).not.toContain('user_supplied');
    const w = await h.world(null);
    await expect(
      h.asDataops((tx) =>
        tx.query(
          "INSERT INTO corpus.sources (jurisdiction_id, name, kind) VALUES ($1, 'SYNTHETIC private', 'user_supplied')",
          [w.jurisdictionId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps end users out of ingestion entirely, and refuses a request made on behalf of a tenant', async () => {
    const [access] = await h.q<{ usage: boolean; corpus_usage: boolean }>(
      "SELECT has_schema_privilege('legalintel_app', 'ingestion', 'USAGE') AS usage, has_schema_privilege('legalintel_app', 'corpus', 'USAGE') AS corpus_usage",
    );
    expect(access?.usage).toBe(false);
    const w = await h.world();
    await expect(
      h
        .pipeline()
        .request(
          { ...h.operator(), organizationId: randomUUID() as never },
          h.prepare(w, syntheticDocument(unique('Tenant'))),
        ),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    await expect(
      h.pipeline().request(
        {
          ...h.operator(),
          principal: {
            kind: 'api_key',
            apiKeyId: randomUUID() as never,
            createdBy: h.staff.operator as never,
          },
        },
        h.prepare(w, syntheticDocument(unique('Key'))),
      ),
    ).rejects.toMatchObject({ category: 'input_invalid' });
  });
});

describe('the migrated schema', () => {
  it('passes every structural guardrail', async () => {
    const found = await h.database.withAdmin((c) =>
      checkGuardrails(c, {
        tenantTableExemptions: ['iam.memberships'],
        securityDefiners: [
          'corpus.enforce_version_lifecycle',
          'corpus.rights_decision_in_force',
          'corpus.source_allows',
          'iam.create_organization',
          'iam.provision_user',
          'iam.resolve_identity',
          'ingestion.attest_provenance',
        ],
      }),
    );
    expect(found, formatViolations(found)).toEqual([]);
  });

  it('defines exactly one SECURITY DEFINER function, the provenance attestation writer, and installs no trigger on a corpus table', async () => {
    const definers = await h.q<{ name: string }>(
      `SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ingestion' AND p.prosecdef`,
    );
    expect(definers).toEqual([{ name: 'attest_provenance' }]);
    const [grants] = await h.q<Record<string, boolean>>(
      `SELECT
         has_function_privilege('legalintel_ingest', 'ingestion.attest_provenance(uuid)', 'EXECUTE') AS ingest,
         has_function_privilege('legalintel_dataops', 'ingestion.attest_provenance(uuid)', 'EXECUTE') AS dataops,
         has_function_privilege('legalintel_app', 'ingestion.attest_provenance(uuid)', 'EXECUTE') AS app`,
    );
    expect(grants).toEqual({ ingest: true, dataops: false, app: false });

    // Corpus tables carry only corpus-owned triggers: ingestion behaviour lives on ingestion tables.
    const foreign = await h.q<{ trigger: string }>(
      `SELECT t.tgname AS trigger
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE NOT t.tgisinternal AND n.nspname IN ('corpus', 'graph') AND pn.nspname = 'ingestion'`,
    );
    expect(foreign).toEqual([]);
  });

  it('gives the ingestion role no way to approve, publish, edit rights or read the operator audit trail', async () => {
    const [privileges] = await h.q<Record<string, boolean>>(
      `SELECT
         has_table_privilege('legalintel_ingest', 'corpus.source_rights_decisions', 'INSERT') AS writes_rights,
         has_table_privilege('legalintel_ingest', 'audit.platform_events', 'SELECT') AS reads_audit,
         has_table_privilege('legalintel_ingest', 'corpus.version_review_decisions', 'INSERT') AS records_decisions,
         has_table_privilege('legalintel_ingest', 'ingestion.review_decisions', 'INSERT') AS decides_tasks,
         has_column_privilege('legalintel_ingest', 'corpus.document_versions', 'approved_by', 'UPDATE') AS approves,
         has_column_privilege('legalintel_ingest', 'corpus.document_versions', 'published_by', 'UPDATE') AS publishes`,
    );
    expect(privileges).toEqual({
      writes_rights: false,
      reads_audit: false,
      records_decisions: false,
      decides_tasks: false,
      approves: false,
      publishes: false,
    });
  });

  it('lets the data-operations role decide but not run or alter ingestion jobs', async () => {
    const [privileges] = await h.q<Record<string, boolean>>(
      `SELECT
         has_table_privilege('legalintel_dataops', 'ingestion.review_decisions', 'INSERT') AS decides,
         has_table_privilege('legalintel_dataops', 'corpus.version_review_decisions', 'INSERT') AS records,
         has_table_privilege('legalintel_dataops', 'ingestion.jobs', 'INSERT') AS creates_jobs,
         has_table_privilege('legalintel_dataops', 'ingestion.jobs', 'UPDATE') AS edits_jobs,
         has_table_privilege('legalintel_dataops', 'ingestion.artifacts', 'INSERT') AS stores_artifacts`,
    );
    expect(privileges).toEqual({
      decides: true,
      records: true,
      creates_jobs: false,
      edits_jobs: false,
      stores_artifacts: false,
    });
  });
});
