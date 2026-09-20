import { corpusStore, VersionId } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, syntheticDocument, unique, type Harness } from './harness';

/**
 * Whoever requested an ingestion may not approve its result, even when one person holds both
 * permissions: role separation alone is not separation of duties. The rule is in ingestion (the
 * requester is an ingestion fact), applies to approval only, and is enforced by the database;
 * the adapter checks first for a clear error.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

/** The person who requested every job in these tests, acting as a reviewer as well. */
const requesterAsReviewer = () => h.contextFor(h.staff.operator, 'data_reviewer');

const pendingJob = async () => {
  const w = await h.world();
  const job = await h.ingestDocument(
    w,
    syntheticDocument(unique('Separation Act'), { identifier: unique('SYN/SEP') }),
  );
  expect(job.status).toBe('pending_review');
  const taskId = await h.taskFor(job.id);
  await h.verifyCritical(taskId); // metadata is verified, so separation is the only thing in the way
  return { w, job, taskId, versionId: VersionId.parse(job.versionId ?? '') };
};

const stateOf = async (versionId: string) =>
  (
    await h.q<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM corpus.document_versions WHERE id = $1',
      [versionId],
    )
  )[0]?.lifecycle_state;
const count = async (sql: string, params: readonly unknown[] = []) =>
  Number((await h.q<{ n: string }>(sql, params))[0]?.n ?? -1);
const decide = (
  context: ReturnType<Harness['reviewer']>,
  taskId: string,
  decision: 'approve' | 'reject' | 'hold',
  reasonCode = 'checked',
) => h.review().decide(context, { taskId, decision, reasonCode });

// =============================================================================================
describe('the requester cannot approve their own ingestion', () => {
  it('refuses the requester’s approval with a typed error, and changes nothing', async () => {
    const { taskId, versionId, job } = await pendingJob();
    expect(
      (
        await h.q<{ actor_id: string }>('SELECT actor_id FROM ingestion.jobs WHERE id = $1', [
          job.id,
        ])
      )[0]?.actor_id,
    ).toBe(h.staff.operator);

    await expect(decide(requesterAsReviewer(), taskId, 'approve')).rejects.toMatchObject({
      kind: 'forbidden',
      code: 'ingestion.requester_cannot_approve',
    });

    expect(await stateOf(versionId)).toBe('pending_review');
    expect(
      await count(
        'SELECT count(*) AS n FROM corpus.version_review_decisions WHERE version_id = $1',
        [versionId],
      ),
    ).toBe(0);
    expect(
      await count('SELECT count(*) AS n FROM ingestion.review_decisions WHERE task_id = $1', [
        taskId,
      ]),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS n FROM audit.platform_events WHERE action = 'ingestion.review_decided' AND resource_id = $1",
        [taskId],
      ),
    ).toBe(0);
  });

  it('lets a different reviewer approve the same job', async () => {
    const { taskId, versionId } = await pendingJob();
    await expect(decide(requesterAsReviewer(), taskId, 'approve')).rejects.toBeDefined();
    await decide(h.reviewer(), taskId, 'approve');
    expect(await stateOf(versionId)).toBe('approved');
    const [row] = await h.q<{ actor_id: string; decision: string }>(
      'SELECT actor_id, decision FROM ingestion.review_decisions WHERE task_id = $1',
      [taskId],
    );
    expect(row).toEqual({ actor_id: h.staff.reviewer, decision: 'approve' });
  });

  it('still lets the requester hold: a hold puts nothing in front of anyone', async () => {
    const { taskId, versionId } = await pendingJob();
    await decide(requesterAsReviewer(), taskId, 'hold', 'wanted_a_second_opinion');
    expect(await stateOf(versionId)).toBe('pending_review');
    const rows = await h.q<{ decision: string; actor_id: string }>(
      'SELECT decision, actor_id FROM ingestion.review_decisions WHERE task_id = $1',
      [taskId],
    );
    expect(rows).toEqual([{ decision: 'hold', actor_id: h.staff.operator }]);
    // The task is still open for someone else to decide.
    expect((await h.review().queue(h.reviewer(), 100)).map((t) => t.id)).toContain(taskId);
  });

  it('still lets the requester reject: withdrawing their own request is safe', async () => {
    const { taskId, versionId } = await pendingJob();
    await decide(requesterAsReviewer(), taskId, 'reject', 'requested_in_error');
    expect(await stateOf(versionId)).toBe('rejected');
    const [row] = await h.q<{ decision: string; actor_id: string }>(
      'SELECT decision, actor_id FROM ingestion.review_decisions WHERE task_id = $1',
      [taskId],
    );
    expect(row).toEqual({ decision: 'reject', actor_id: h.staff.operator });
  });

  it('does not let a hold earn the requester the right to approve later', async () => {
    const { taskId, versionId } = await pendingJob();
    await decide(requesterAsReviewer(), taskId, 'hold');
    await expect(decide(requesterAsReviewer(), taskId, 'approve')).rejects.toMatchObject({
      code: 'ingestion.requester_cannot_approve',
    });
    await decide(h.reviewer(), taskId, 'approve');
    expect(await stateOf(versionId)).toBe('approved');
  });

  it('lets the requester see the packet and the queue, where their role permits', async () => {
    const { taskId } = await pendingJob();
    const packet = await h.review().packet(requesterAsReviewer(), taskId);
    expect(packet['task']).toBeDefined();
    expect((await h.review().queue(requesterAsReviewer(), 100)).map((t) => t.id)).toContain(taskId);
  });

  it('is about the person, not the role: a reviewer who did not request the job is unaffected', async () => {
    const first = await pendingJob();
    const second = await pendingJob();
    await decide(h.reviewer(), first.taskId, 'approve');
    await decide(h.reviewer(), second.taskId, 'approve');
    expect(await stateOf(first.versionId)).toBe('approved');
    expect(await stateOf(second.versionId)).toBe('approved');
  });
});

// =============================================================================================
describe('the database refuses the requester’s approval, whatever the caller does', () => {
  /** Records the corpus decision and the approval as `actor`, then the ingestion mirror row. */
  const selfApproveInSql = (
    taskId: string,
    versionId: VersionId,
    actor: string,
    decision = 'approve',
  ) =>
    h.asDataops(async (tx) => {
      const corpusDecisionId = await corpusStore.recordReviewDecision(tx, {
        versionId,
        decision: decision as 'approve' | 'reject' | 'hold',
        reasonCode: 'checked',
        decidedBy: actor,
      });
      if (decision === 'approve') {
        await tx.query(
          "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
          [versionId, actor],
        );
      }
      await tx.query(
        `INSERT INTO ingestion.review_decisions (task_id, decision, actor_id, reason_code, corpus_decision_id)
         VALUES ($1, $2, $3, 'checked', $4)`,
        [taskId, decision, actor, corpusDecisionId],
      );
    });

  it('refuses a direct insert of the requester’s approval, and rolls everything back with it', async () => {
    const { taskId, versionId } = await pendingJob();
    await expect(selfApproveInSql(taskId, versionId, h.staff.operator)).rejects.toMatchObject({
      hint: 'ingestion.requester_cannot_approve',
    });
    expect(await stateOf(versionId)).toBe('pending_review');
    expect(
      await count(
        'SELECT count(*) AS n FROM corpus.version_review_decisions WHERE version_id = $1',
        [versionId],
      ),
    ).toBe(0);
    expect(
      await count('SELECT count(*) AS n FROM ingestion.review_decisions WHERE task_id = $1', [
        taskId,
      ]),
    ).toBe(0);
  });

  it('accepts the identical statements when someone else is the approver (so the refusal is the rule)', async () => {
    const { taskId, versionId } = await pendingJob();
    await selfApproveInSql(taskId, versionId, h.staff.reviewer);
    expect(await stateOf(versionId)).toBe('approved');
  });

  it('does not touch hold or reject, in SQL either', async () => {
    for (const decision of ['hold', 'reject'] as const) {
      const { taskId, versionId } = await pendingJob();
      if (decision === 'reject') {
        await h.asDataops(async (tx) => {
          const id = await corpusStore.recordReviewDecision(tx, {
            versionId,
            decision,
            reasonCode: 'checked',
            decidedBy: h.staff.operator,
          });
          await tx.query(
            "UPDATE corpus.document_versions SET lifecycle_state = 'rejected' WHERE id = $1",
            [versionId],
          );
          await tx.query(
            `INSERT INTO ingestion.review_decisions (task_id, decision, actor_id, reason_code, corpus_decision_id)
             VALUES ($1, 'reject', $2, 'checked', $3)`,
            [taskId, h.staff.operator, id],
          );
        });
        expect(await stateOf(versionId)).toBe('rejected');
      } else {
        await selfApproveInSql(taskId, versionId, h.staff.operator, 'hold');
        expect(await stateOf(versionId)).toBe('pending_review');
      }
    }
  });

  it('cannot be evaded by changing who requested the job: the requester is immutable', async () => {
    const { job } = await pendingJob();
    // The ingest role may not touch the column at all ...
    await expect(
      h.asIngest((tx) =>
        tx.query('UPDATE ingestion.jobs SET actor_id = $2 WHERE id = $1', [
          job.id,
          h.staff.reviewer,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // ... and even a superuser is refused by the job guard.
    await expect(
      h.database.withAdmin((c) =>
        c.query('UPDATE ingestion.jobs SET actor_id = $2 WHERE id = $1', [
          job.id,
          h.staff.reviewer,
        ]),
      ),
    ).rejects.toBeDefined();
    expect(
      (
        await h.q<{ actor_id: string }>('SELECT actor_id FROM ingestion.jobs WHERE id = $1', [
          job.id,
        ])
      )[0]?.actor_id,
    ).toBe(h.staff.operator);
  });
});
