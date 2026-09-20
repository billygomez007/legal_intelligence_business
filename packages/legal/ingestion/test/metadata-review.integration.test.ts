import { corpusStore, fieldFingerprint, VersionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, syntheticDocument, unique, type Harness } from './harness';

/**
 * Machine extraction proposes metadata; a person verifies it before a version can be approved.
 * These run through the reviewer-facing adapter (packet, verifyMetadata, recordCaseDetails,
 * decide) against the real pipeline and database. The corpus tests attack the same rules with
 * direct SQL.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

interface CriticalRow {
  field: string;
  value: string | null;
  valueSha256: string | null;
  blocking: boolean;
  isCurrent: boolean;
  latestStatus: string | null;
}
const criticalOf = async (taskId: string): Promise<CriticalRow[]> =>
  (await h.review().packet(h.reviewer(), taskId))['criticalMetadata'] as CriticalRow[];

const pendingLegislation = async () => {
  const w = await h.world();
  const job = await h.ingestDocument(
    w,
    syntheticDocument(unique('Metadata Act'), { identifier: unique('SYN/META') }),
  );
  expect(job.status).toBe('pending_review');
  return {
    w,
    job,
    taskId: await h.taskFor(job.id),
    versionId: VersionId.parse(job.versionId ?? ''),
  };
};

const CASE_TEXT = (title: string) =>
  [
    `Title: SYNTHETIC ${title} (NOT REAL LAW)`,
    `Identifier: ${unique('SYN/CASE')}`,
    'Court: SYNTHETIC High Court',
    'Decision date: 2000-01-01',
    '',
    '1. The fictional court held for the fictional appellant.',
  ].join('\n');

const pendingCase = async () => {
  const w = await h.world();
  const job = await h.ingestDocument(w, CASE_TEXT(unique('A v B')), { documentType: 'case' });
  expect(job.status).toBe('pending_review');
  return {
    w,
    job,
    taskId: await h.taskFor(job.id),
    versionId: VersionId.parse(job.versionId ?? ''),
  };
};

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('the packet did not contain the expected field');
  return value;
};

const verificationFor = (row: CriticalRow, evidence = 'SYNTHETIC: read against the source') => ({
  field: row.field,
  status: 'verified',
  valueSha256: row.valueSha256,
  evidenceReference: evidence,
});

const approve = (taskId: string) =>
  h.review().decide(h.reviewer(), { taskId, decision: 'approve', reasonCode: 'checked' });

// =============================================================================================
describe('a reviewer must verify the publish-critical metadata before approving', () => {
  it('refuses approval of machine-only metadata, and approves once a person has verified it', async () => {
    const { taskId, versionId } = await pendingLegislation();
    const rows = await criticalOf(taskId);
    expect(
      rows
        .filter((row) => row.blocking)
        .map((row) => row.field)
        .sort(),
    ).toEqual(['jurisdiction', 'title']);

    await expect(approve(taskId)).rejects.toMatchObject({ category: 'validation_failed' });
    expect(
      await h.q(
        "SELECT 1 FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'approved'",
        [versionId],
      ),
    ).toHaveLength(0);

    await h.review().verifyMetadata(h.reviewer(), {
      taskId,
      verifications: rows.filter((row) => row.blocking).map((row) => verificationFor(row)),
    });
    await approve(taskId);
    expect(
      await h.q(
        "SELECT 1 FROM corpus.document_versions WHERE id = $1 AND lifecycle_state = 'approved'",
        [versionId],
      ),
    ).toHaveLength(1);
  });

  it('keeps machine evidence exactly as extracted: verifying does not touch it', async () => {
    const { taskId, versionId } = await pendingLegislation();
    const before = await h.q<{ fields: unknown }>(
      'SELECT fields FROM ingestion.version_evidence WHERE version_id = $1',
      [versionId],
    );
    await h.verifyCritical(taskId);
    const after = await h.q<{ fields: unknown }>(
      'SELECT fields FROM ingestion.version_evidence WHERE version_id = $1',
      [versionId],
    );
    expect(after).toEqual(before);
    expect(JSON.stringify(after[0]?.fields)).toContain('"reviewState":"unreviewed"');
  });

  it('shows the reviewer the latest verification, and marks it current', async () => {
    const { taskId } = await pendingLegislation();
    await h.verifyCritical(taskId);
    const rows = await criticalOf(taskId);
    const title = rows.find((row) => row.field === 'title');
    expect(title).toMatchObject({ isCurrent: true, latestStatus: 'verified', blocking: false });
  });

  it('refuses a fingerprint that is not the value shown (a stale or invented one)', async () => {
    const { taskId } = await pendingLegislation();
    const [title] = (await criticalOf(taskId)).filter((row) => row.field === 'title');
    await expect(
      h.review().verifyMetadata(h.reviewer(), {
        taskId,
        verifications: [
          {
            field: 'title',
            status: 'verified',
            valueSha256: fieldFingerprint('title', 'Something else').toString('hex'),
            evidenceReference: 'SYNTHETIC',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'corpus.verification_stale' });
    expect(title?.blocking).toBe(true);
  });

  it('refuses a field that does not apply, with the corpus’s typed error', async () => {
    const { taskId } = await pendingLegislation();
    await expect(
      h.review().verifyMetadata(h.reviewer(), {
        taskId,
        verifications: [
          {
            field: 'court',
            status: 'verified',
            valueSha256: fieldFingerprint('court', 'x').toString('hex'),
            evidenceReference: 'SYNTHETIC',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'corpus.field_not_applicable' });
  });

  it('is atomic: one bad verification records none of the batch', async () => {
    const { taskId, versionId } = await pendingLegislation();
    const [title] = (await criticalOf(taskId)).filter((row) => row.field === 'title');
    await expect(
      h.review().verifyMetadata(h.reviewer(), {
        taskId,
        verifications: [
          verificationFor(must(title)),
          {
            field: 'jurisdiction',
            status: 'verified',
            valueSha256: fieldFingerprint('jurisdiction', 'wrong').toString('hex'),
            evidenceReference: 'SYNTHETIC',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'corpus.verification_stale' });
    expect(
      await h.q('SELECT 1 FROM corpus.version_field_verifications WHERE version_id = $1', [
        versionId,
      ]),
    ).toHaveLength(0);
  });

  it('is for staff who hold corpus:review, and for a user', async () => {
    const { taskId } = await pendingLegislation();
    const input = { taskId, verifications: [] as unknown[] };
    for (const context of [h.operator(), h.publisher()]) {
      await expect(h.review().verifyMetadata(context, input)).rejects.toMatchObject({
        kind: 'forbidden',
      });
    }
    await expect(
      h
        .review()
        .verifyMetadata(
          { ...h.reviewer(), principal: { kind: 'system', name: 'a machine' } },
          input,
        ),
    ).rejects.toBeDefined();
  });

  it('validates its input strictly', async () => {
    const { taskId } = await pendingLegislation();
    const good = {
      field: 'title',
      status: 'verified',
      valueSha256: 'a'.repeat(64),
      evidenceReference: 'SYNTHETIC',
    };
    for (const input of [
      { taskId, verifications: [] },
      { taskId: 'not-a-uuid', verifications: [good] },
      { taskId, verifications: [{ ...good, field: 'made_up' }] },
      { taskId, verifications: [{ ...good, status: 'approved' }] },
      { taskId, verifications: [{ ...good, valueSha256: 'xyz' }] },
      { taskId, verifications: [{ ...good, valueSha256: 'A'.repeat(64) }] },
      { taskId, verifications: [{ ...good, evidenceReference: '   ' }] },
      { taskId, verifications: [{ ...good, evidenceReference: 'x'.repeat(501) }] },
      { taskId, verifications: [{ ...good, extra: true }] },
      { taskId, verifications: [good], extra: true },
    ]) {
      await expect(h.review().verifyMetadata(h.reviewer(), input)).rejects.toMatchObject({
        category: 'input_invalid',
      });
    }
  });

  it('only works on a task that has a version awaiting review', async () => {
    const { taskId } = await pendingLegislation();
    await h.verifyCritical(taskId);
    await approve(taskId);
    // Once approved, a further verification is refused by the corpus (the version left review).
    const [title] = (await criticalOf(taskId)).filter((row) => row.field === 'title');
    await expect(
      h.review().verifyMetadata(h.reviewer(), {
        taskId,
        verifications: [verificationFor(must(title))],
      }),
    ).rejects.toMatchObject({ code: 'corpus.review_not_pending' });

    // A failed or duplicate job has no version at all.
    const w = await h.world();
    const content = syntheticDocument(unique('Dup'), { identifier: unique('SYN/DUP') });
    await h.ingestDocument(w, content);
    const again = await h.ingestDocument(w, content);
    const dupTask = await h.taskFor(again.id);
    await expect(
      h.review().verifyMetadata(h.reviewer(), {
        taskId: dupTask,
        verifications: [{ ...verificationFor(must(title)), valueSha256: 'a'.repeat(64) }],
      }),
    ).rejects.toMatchObject({ category: 'input_invalid' });
  });

  it('is audited by field and outcome, never by value', async () => {
    const { taskId } = await pendingLegislation();
    await h.verifyCritical(taskId);
    const events = await h.q<{ metadata: Record<string, string> }>(
      `SELECT metadata FROM audit.platform_events
        WHERE action = 'ingestion.metadata_verified' AND resource_id = $1`,
      [taskId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata['fields']).toBe('jurisdiction,title');
    expect(JSON.stringify(events[0]?.metadata)).not.toContain('SYNTHETIC');
  });
});

// =============================================================================================
describe('a case needs its court and decision date recorded by a person, then verified', () => {
  it('cannot be approved with no court and date, and can once they are recorded and verified', async () => {
    const { w, taskId } = await pendingCase();
    const rows = await criticalOf(taskId);
    expect(rows.find((row) => row.field === 'court')).toMatchObject({
      value: null,
      blocking: true,
    });
    await expect(approve(taskId)).rejects.toMatchObject({ category: 'validation_failed' });

    const courtId = await h.asDataops((tx) =>
      corpusStore.createCourt(tx, {
        jurisdictionId: w.jurisdictionId,
        name: unique('SYNTHETIC High Court'),
        level: 3,
        authorityRank: 3,
      }),
    );
    await h.review().recordCaseDetails(h.reviewer(), {
      taskId,
      courtId,
      decisionDate: '2000-01-01',
      neutralCitation: '[SYNTHETIC 2000] HC 1',
    });
    await h.verifyCritical(taskId);
    await approve(taskId);
  });

  it('invalidates an earlier verification when a person changes what was verified', async () => {
    const { w, taskId } = await pendingCase();
    const courtId = await h.asDataops((tx) =>
      corpusStore.createCourt(tx, {
        jurisdictionId: w.jurisdictionId,
        name: unique('SYNTHETIC Court'),
        level: 3,
        authorityRank: 3,
      }),
    );
    await h
      .review()
      .recordCaseDetails(h.reviewer(), { taskId, courtId, decisionDate: '2000-01-01' });
    await h.verifyCritical(taskId);
    await h
      .review()
      .recordCaseDetails(h.reviewer(), { taskId, courtId, decisionDate: '2001-02-03' });
    await expect(approve(taskId)).rejects.toMatchObject({ category: 'validation_failed' });
    await h.verifyCritical(taskId); // only the changed field blocks, and is verified again
    await approve(taskId);
  });

  it('refuses a court from another jurisdiction', async () => {
    const { taskId } = await pendingCase();
    const other = await h.world();
    const foreignCourt = await h.asDataops((tx) =>
      corpusStore.createCourt(tx, {
        jurisdictionId: other.jurisdictionId,
        name: unique('SYNTHETIC Foreign Court'),
        level: 1,
        authorityRank: 1,
      }),
    );
    await expect(
      h.review().recordCaseDetails(h.reviewer(), {
        taskId,
        courtId: foreignCourt,
        decisionDate: '2000-01-01',
      }),
    ).rejects.toMatchObject({ code: 'corpus.reference_not_found' });
  });

  it('is not for legislation, and validates dates and lengths', async () => {
    const legislation = await pendingLegislation();
    const c = await pendingCase();
    const courtId = await h.asDataops((tx) =>
      corpusStore.createCourt(tx, {
        jurisdictionId: c.w.jurisdictionId,
        name: unique('SYNTHETIC Court'),
        level: 3,
        authorityRank: 3,
      }),
    );
    await expect(
      h.review().recordCaseDetails(h.reviewer(), {
        taskId: legislation.taskId,
        courtId,
        decisionDate: '2000-01-01',
      }),
    ).rejects.toMatchObject({ category: 'input_invalid' });
    for (const input of [
      { taskId: c.taskId, courtId, decisionDate: '2000-13-45' },
      { taskId: c.taskId, courtId, decisionDate: '01/02/2000' },
      { taskId: c.taskId, courtId, decisionDate: '2000-01-01', docketNumber: '' },
      { taskId: c.taskId, courtId, decisionDate: '2000-01-01', neutralCitation: 'x'.repeat(201) },
      { taskId: c.taskId, courtId: 'nope', decisionDate: '2000-01-01' },
      { taskId: c.taskId, courtId, decisionDate: '2000-01-01', extra: 1 },
    ]) {
      await expect(h.review().recordCaseDetails(h.reviewer(), input)).rejects.toMatchObject({
        category: 'input_invalid',
      });
    }
  });

  it('is for staff who hold corpus:review', async () => {
    const { taskId } = await pendingCase();
    for (const context of [h.operator(), h.publisher()]) {
      await expect(
        h.review().recordCaseDetails(context, {
          taskId,
          courtId: '00000000-0000-4000-8000-000000000000',
          decisionDate: '2000-01-01',
        }),
      ).rejects.toMatchObject({ kind: 'forbidden' });
    }
  });
});
