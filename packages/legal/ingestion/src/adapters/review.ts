import { withPublicTransaction, type DbPool } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';
import { z } from 'zod';
import { IngestionFailure } from '../domain/model';

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

/** Use a dataops pool. Output contains protected content and must never enter logs. */
export class IngestionReview {
  constructor(private readonly pool: DbPool) {}
  async queue(
    context: AuthzContext,
    limit = 50,
  ): Promise<{ id: string; job_id: string; reason: string }[]> {
    requireStaff(context, 'ingestion:inspect');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new IngestionFailure('input_invalid');
    return (
      await this.pool.query<{ id: string; job_id: string; reason: string }>(
        `SELECT t.id,t.job_id,t.reason FROM ingestion.review_tasks t
      WHERE NOT EXISTS(SELECT 1 FROM ingestion.review_decisions d WHERE d.task_id=t.id) ORDER BY t.created_at LIMIT $1`,
        [limit],
      )
    ).rows;
  }
  async packet(context: AuthzContext, taskId: string): Promise<Record<string, unknown>> {
    requireStaff(context, 'ingestion:inspect');
    if (!z.uuid().safeParse(taskId).success) throw new IngestionFailure('input_invalid');
    const result = await this.pool.query<{ packet: Record<string, unknown> }>(
      `SELECT jsonb_build_object(
      'task',to_jsonb(t),'job',to_jsonb(j),'source',to_jsonb(s),'artifact',to_jsonb(a),'rightsEvidence',r.evidence_reference,
      'currentProcessingAllowed',corpus.source_allows(j.source_id,'acquire_store') AND corpus.source_allows(j.source_id,'derive_metadata'),
      'extraction',to_jsonb(e),'metadata',to_jsonb(ve),
      'passages',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ordinal) FROM corpus.passages p WHERE p.version_id=t.version_id),'[]'::jsonb),
      'citations',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM ingestion.citation_candidates c WHERE c.version_id=t.version_id),'[]'::jsonb),
      'decision',(SELECT to_jsonb(d) FROM ingestion.review_decisions d WHERE d.task_id=t.id)) AS packet
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
    const decision = decisionSchema.safeParse(input);
    if (!decision.success) throw new IngestionFailure('input_invalid');
    const { taskId, reasonCode } = decision.data;
    await withPublicTransaction(this.pool, async (tx) => {
      // The trigger performs the lifecycle decision and audit atomically; no publication here.
      await tx.query(
        `INSERT INTO ingestion.review_decisions(task_id,decision,actor_id,reason_code) VALUES($1,$2,$3,$4)`,
        [
          taskId,
          decision.data.decision,
          context.principal.kind === 'user' ? context.principal.userId : null,
          reasonCode,
        ],
      );
    });
  }
}
