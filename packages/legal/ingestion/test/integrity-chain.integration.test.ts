import { corpusStore, VersionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, syntheticDocument, unique, type Harness } from './harness';

/**
 * The whole chain, end to end, through the real pipeline, review adapter and corpus: each gate is
 * met in turn and each refuses when it is the one that is missing, so a version reaches users only
 * by way of a provenance attestation, a person's verification of its critical metadata, an
 * approver who did not request it, and a publisher who did not approve it.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

const requesterAsReviewer = () => h.contextFor(h.staff.operator, 'data_reviewer');

describe('a version reaches users only through every gate, in order', () => {
  it('needs the attestation, the verification, another approver and another publisher', async () => {
    const w = await h.world(['acquire_store', 'derive_metadata']); // no display or search rights yet
    const job = await h.ingestDocument(
      w,
      syntheticDocument(unique('Chain Act'), { identifier: unique('SYN/CHAIN') }),
    );
    const versionId = VersionId.parse(job.versionId ?? '');
    const taskId = await h.taskFor(job.id);
    const publish = (by: string) =>
      h.asDataops((tx) => corpusStore.publishVersion(tx, versionId, by));
    const state = async () =>
      (
        await h.q<{ lifecycle_state: string }>(
          'SELECT lifecycle_state FROM corpus.document_versions WHERE id = $1',
          [versionId],
        )
      )[0]?.lifecycle_state;

    // 1. The pipeline attested what it handed off.
    expect(
      await h.q('SELECT 1 FROM corpus.version_provenance_attestations WHERE version_id = $1', [
        versionId,
      ]),
    ).toHaveLength(1);
    expect(await state()).toBe('pending_review');

    // 2. Nothing can be published from review.
    await expect(publish(h.staff.publisher)).rejects.toMatchObject({
      code: 'corpus.invalid_transition',
    });

    // 3. The requester cannot approve, even holding the reviewer permission.
    await expect(
      h
        .review()
        .decide(requesterAsReviewer(), { taskId, decision: 'approve', reasonCode: 'checked' }),
    ).rejects.toMatchObject({ code: 'ingestion.requester_cannot_approve' });

    // 4. Another reviewer cannot approve until a person has verified the critical metadata.
    await expect(
      h.review().decide(h.reviewer(), { taskId, decision: 'approve', reasonCode: 'checked' }),
    ).rejects.toMatchObject({ category: 'validation_failed' });
    await h.verifyCritical(taskId);

    // 5. Now approval works, and is by someone other than the requester.
    await h.review().decide(h.reviewer(), { taskId, decision: 'approve', reasonCode: 'checked' });
    expect(await state()).toBe('approved');

    // 6. The approver cannot also publish (two-person rule), and rights must allow display.
    await expect(publish(h.staff.reviewer)).rejects.toMatchObject({
      code: expect.stringMatching(/two_person_rule|rights_not_cleared/) as unknown,
    });
    await expect(publish(h.staff.publisher)).rejects.toMatchObject({
      code: 'corpus.rights_not_cleared',
    });
    await h.grant(w.sourceId, 'approved', [
      'acquire_store',
      'derive_metadata',
      'display',
      'index_search',
    ]);

    // 7. A different person, with the rights, publishes; users can now see it.
    await publish(h.staff.publisher);
    expect(await state()).toBe('published');
    expect(await h.asApp((tx) => corpusStore.getVersion(tx, versionId))).toMatchObject({
      lifecycleState: 'published',
    });

    // 8. Every record the gates relied on is still there, and none can be altered.
    const [counts] = await h.q<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM corpus.version_provenance_attestations WHERE version_id = $1) AS attestations,
         (SELECT count(*) FROM corpus.version_field_verifications WHERE version_id = $1) AS verifications,
         (SELECT count(*) FROM corpus.version_review_decisions WHERE version_id = $1 AND decision = 'approve') AS approvals,
         (SELECT count(*) FROM ingestion.review_decisions WHERE task_id = $2 AND decision = 'approve') AS mirrored`,
      [versionId, taskId],
    );
    expect(counts).toEqual({
      attestations: '1',
      verifications: '2',
      approvals: '1',
      mirrored: '1',
    });
  });

  it('never publishes what was approved without a verification, whichever path approval took', async () => {
    const w = await h.world(['acquire_store', 'derive_metadata', 'display', 'index_search']);
    const job = await h.ingestDocument(
      w,
      syntheticDocument(unique('Bypass Act'), { identifier: unique('SYN/BYP') }),
    );
    const versionId = VersionId.parse(job.versionId ?? '');
    // The ingest role cannot approve; the data-ops role cannot approve unverified metadata.
    await expect(
      h.asDataops((tx) => corpusStore.approveVersion(tx, versionId, h.staff.reviewer)),
    ).rejects.toMatchObject({ code: 'corpus.metadata_unverified' });
    await expect(
      h.asIngest((tx) =>
        tx.query(
          "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
          [versionId, h.staff.reviewer],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      h.asDataops((tx) => corpusStore.publishVersion(tx, versionId, h.staff.publisher)),
    ).rejects.toMatchObject({ code: 'corpus.invalid_transition' });
  });
});
