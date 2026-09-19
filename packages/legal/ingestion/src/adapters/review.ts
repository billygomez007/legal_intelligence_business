import { recordPlatformAuditEvent } from '@legalintel/audit';
import { withPublicTransaction, type DbPool } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';
import { corpusStore, VersionId } from '@legalintel/legal-corpus';
import { z } from 'zod';

import { failureCategory, IngestionFailure } from '../domain/model';
import { currentRights, LOCK_NAMESPACE } from './rights';

const decisionSchema = z.strictObject({
  taskId: z.uuid(),
  decision: z.enum(['approve', 'reject', 'hold']),
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
});
const requireStaff = (context: AuthzContext, permission: string) => {
  enforce(context, permission);
  if (context.organizationId !== null || context.principal.kind !== 'user')
    throw new IngestionFailure('input_invalid');
};

interface TaskRow {
  version_id: string | null;
  job_status: string;
  source_id: string;
  decided: boolean;
}

/**
 * The human side of ingestion: a person reads a review packet and decides. Use a dataops pool.
 *
 * A decision is recorded in the corpus first (the corpus refuses approval without one), then
 * mirrored on the ingestion task, in one transaction. It approves or rejects; it never
 * publishes, which is a separate permission held by a different person.
 *
 * Output contains protected content and must never enter logs.
 */
export class IngestionReview {
  constructor(
    private readonly pool: DbPool,
    /** Role and production-safety checks from the composition root, run before each action. */
    private readonly assertSafe: () => Promise<void> = () => Promise.resolve(),
  ) {}

  async queue(
    context: AuthzContext,
    limit = 50,
  ): Promise<{ id: string; job_id: string; reason: string }[]> {
    requireStaff(context, 'ingestion:inspect');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new IngestionFailure('input_invalid');
    await this.assertSafe();
    // A held task stays in the queue; only an approval or rejection closes it.
    return (
      await this.pool.query<{ id: string; job_id: string; reason: string }>(
        `SELECT t.id,t.job_id,t.reason FROM ingestion.review_tasks t
          WHERE NOT EXISTS(SELECT 1 FROM ingestion.review_decisions d
                            WHERE d.task_id=t.id AND d.decision IN ('approve','reject'))
          ORDER BY t.created_at LIMIT $1`,
        [limit],
      )
    ).rows;
  }

  async packet(context: AuthzContext, taskId: string): Promise<Record<string, unknown>> {
    requireStaff(context, 'ingestion:inspect');
    if (!z.uuid().safeParse(taskId).success) throw new IngestionFailure('input_invalid');
    await this.assertSafe();
    const result = await this.pool.query<{ packet: Record<string, unknown> }>(
      `SELECT jsonb_build_object(
      'task',to_jsonb(t),'job',to_jsonb(j),'source',to_jsonb(s),'artifact',to_jsonb(a),'rightsEvidence',r.evidence_reference,
      'currentProcessingAllowed',corpus.source_allows(j.source_id,'acquire_store') AND corpus.source_allows(j.source_id,'derive_metadata'),
      'extraction',to_jsonb(e),'metadata',to_jsonb(ve),
      'passages',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ordinal) FROM corpus.passages p WHERE p.version_id=t.version_id),'[]'::jsonb),
      'citations',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM ingestion.citation_candidates c WHERE c.version_id=t.version_id),'[]'::jsonb),
      'decisions',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.sequence) FROM ingestion.review_decisions d WHERE d.task_id=t.id),'[]'::jsonb)) AS packet
      FROM ingestion.review_tasks t JOIN ingestion.jobs j ON j.id=t.job_id JOIN corpus.sources s ON s.id=j.source_id
      LEFT JOIN ingestion.artifacts a ON a.id=j.artifact_id LEFT JOIN corpus.source_rights_decisions r ON r.id=a.rights_decision_id
      LEFT JOIN ingestion.extractions e ON e.job_id=j.id LEFT JOIN ingestion.version_evidence ve ON ve.job_id=j.id WHERE t.id=$1`,
      [taskId],
    );
    if (result.rows[0] === undefined) throw new IngestionFailure('input_invalid');
    return result.rows[0].packet;
  }

  async decide(context: AuthzContext, input: unknown): Promise<void> {
    requireStaff(context, 'corpus:review');
    if (context.principal.kind !== 'user') throw new IngestionFailure('input_invalid');
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) throw new IngestionFailure('input_invalid');
    const { taskId, decision, reasonCode } = parsed.data;
    const actorId = context.principal.userId;
    await this.assertSafe();
    try {
      await withPublicTransaction(this.pool, async (tx) => {
        // Serialize decisions on one task; the tables are append-only, so there is no row to lock.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
          taskId,
          LOCK_NAMESPACE.review,
        ]);
        const found = await tx.query<TaskRow>(
          `SELECT t.version_id, j.status AS job_status, j.source_id,
                  EXISTS(SELECT 1 FROM ingestion.review_decisions d
                          WHERE d.task_id=t.id AND d.decision IN ('approve','reject')) AS decided
             FROM ingestion.review_tasks t JOIN ingestion.jobs j ON j.id=t.job_id WHERE t.id=$1`,
          [taskId],
        );
        const task = found.rows[0];
        // The first approval or rejection closes a task. The database refuses a second one as
        // well; this says so before anything is written.
        if (task === undefined || task.decided) throw new IngestionFailure('input_invalid');

        let corpusDecisionId: string | null = null;
        if (task.version_id !== null) {
          if (task.job_status !== 'pending_review') throw new IngestionFailure('validation_failed');
          const versionId = VersionId.parse(task.version_id);
          if (decision === 'approve') {
            // Fail closed: approving is acting on the source's content, so the rights must
            // hold now. Rejecting or holding never asks, so refusing stays possible after a
            // revocation.
            await currentRights(tx, task.source_id);
            corpusDecisionId = await corpusStore.approveVersion(tx, versionId, actorId, reasonCode);
          } else {
            corpusDecisionId = await corpusStore.recordReviewDecision(tx, {
              versionId,
              decision,
              reasonCode,
              decidedBy: actorId,
            });
            if (decision === 'reject') await corpusStore.rejectVersion(tx, versionId);
          }
        }
        await tx.query(
          `INSERT INTO ingestion.review_decisions(task_id,decision,actor_id,reason_code,corpus_decision_id)
           VALUES($1,$2,$3,$4,$5)`,
          [taskId, decision, actorId, reasonCode, corpusDecisionId],
        );
        await recordPlatformAuditEvent(tx, {
          actorKind: 'user',
          actorId,
          action: 'ingestion.review_decided',
          outcome: 'success',
          resourceType: 'review_task',
          resourceId: taskId,
          metadata: { decision, reasonCode },
        });
      });
    } catch (error) {
      // Callers get a typed category, never the database's words.
      throw error instanceof IngestionFailure
        ? error
        : new IngestionFailure(failureCategory(error));
    }
  }
}
