import { recordPlatformAuditEvent } from '@legalintel/audit';
import { withPublicTransaction, type DbPool, type Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';
import { forbidden, isAppError } from '@legalintel/kernel';
import {
  corpusStore,
  DocumentId,
  JurisdictionId,
  METADATA_FIELDS,
  VERIFICATION_STATUSES,
  VersionId,
  CourtId,
} from '@legalintel/legal-corpus';
import { z } from 'zod';

import { failureCategory, IngestionFailure } from '../domain/model';
import { currentRights, LOCK_NAMESPACE } from './rights';

const decisionSchema = z.strictObject({
  taskId: z.uuid(),
  decision: z.enum(['approve', 'reject', 'hold']),
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
});
/**
 * A person's verification of publish-critical metadata: which field, what they concluded, the
 * fingerprint of the value they saw (from the review packet) and where they checked it.
 */
const verificationSchema = z.strictObject({
  taskId: z.uuid(),
  verifications: z
    .array(
      z.strictObject({
        field: z.enum(METADATA_FIELDS),
        status: z.enum(VERIFICATION_STATUSES),
        valueSha256: z.string().regex(/^[a-f0-9]{64}$/),
        evidenceReference: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(METADATA_FIELDS.length),
});
/** Case details a person copied from the source. Dates are ISO calendar dates. */
const caseDetailsSchema = z.strictObject({
  taskId: z.uuid(),
  courtId: z.uuid(),
  decisionDate: z.iso.date(),
  neutralCitation: z.string().trim().min(1).max(200).optional(),
  docketNumber: z.string().trim().min(1).max(200).optional(),
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
  requester_id: string;
  decided: boolean;
}

export const REQUESTER_CANNOT_APPROVE = 'ingestion.requester_cannot_approve';

/**
 * What a caller sees for anything thrown while deciding: the requester rule as its own typed,
 * fixed-message refusal (whether the adapter or the database caught it), the ingestion failure
 * that is already typed, and otherwise a category, never the database's words.
 */
export function translateReviewError(error: unknown): unknown {
  if (error instanceof IngestionFailure) return error;
  if (isAppError(error) && error.code === REQUESTER_CANNOT_APPROVE) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'hint' in error &&
    error.hint === REQUESTER_CANNOT_APPROVE
  ) {
    return requesterCannotApprove();
  }
  return new IngestionFailure(failureCategory(error));
}

const requesterCannotApprove = () =>
  forbidden(
    REQUESTER_CANNOT_APPROVE,
    'The person who requested an ingestion cannot approve its result. Another reviewer must.',
  );

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
      'criticalMetadata',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'field',m.field,'requirement',m.requirement,'value',m.current_value,
          'valueSha256',encode(m.current_sha256,'hex'),'latestStatus',m.latest_status,
          'latestBy',m.latest_by,'latestAt',m.latest_at,'isCurrent',m.is_current,'blocking',m.is_blocking) ORDER BY m.field)
        FROM corpus.version_critical_metadata(t.version_id) m),'[]'::jsonb),
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

  /**
   * Machine extraction proposes metadata; a person verifies it. This records that person's
   * verification of one or more publish-critical fields of the version a task is about, each
   * bound to the exact value they saw (a fingerprint from the packet's `criticalMetadata`), with
   * the evidence they checked. The corpus refuses a stale fingerprint, a field that does not
   * apply, and a version that is not awaiting review, and approval refuses to proceed until every
   * required field has a current verification. Errors are the corpus's typed errors.
   */
  async verifyMetadata(context: AuthzContext, input: unknown): Promise<void> {
    requireStaff(context, 'corpus:review');
    if (context.principal.kind !== 'user') throw new IngestionFailure('input_invalid');
    const parsed = verificationSchema.safeParse(input);
    if (!parsed.success) throw new IngestionFailure('input_invalid');
    const { taskId, verifications } = parsed.data;
    const actorId = context.principal.userId;
    await this.assertSafe();
    try {
      await withPublicTransaction(this.pool, async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
          taskId,
          LOCK_NAMESPACE.review,
        ]);
        const task = await this.pendingVersion(tx, taskId);
        for (const verification of verifications) {
          await corpusStore.recordFieldVerification(tx, {
            versionId: VersionId.parse(task.versionId),
            field: verification.field,
            status: verification.status,
            valueSha256: Buffer.from(verification.valueSha256, 'hex'),
            evidenceReference: verification.evidenceReference,
            verifiedBy: actorId,
          });
        }
        await recordPlatformAuditEvent(tx, {
          actorKind: 'user',
          actorId,
          action: 'ingestion.metadata_verified',
          outcome: 'success',
          resourceType: 'review_task',
          resourceId: taskId,
          // Field names and outcomes only: the values are protected content.
          metadata: {
            fields: verifications.map((v) => v.field).join(','),
            statuses: verifications.map((v) => v.status).join(','),
          },
        });
      });
    } catch (error) {
      throw isAppError(error) || error instanceof IngestionFailure
        ? error
        : new IngestionFailure(failureCategory(error));
    }
  }

  /**
   * Records the case details (court, decision date, identifiers) a person took from the source,
   * for a case awaiting review. Machine extraction does not write these; without them a case has
   * no court or date for a person to verify. It replaces what was recorded, and any earlier
   * verification of a changed value no longer matches, so it must be made again.
   */
  async recordCaseDetails(context: AuthzContext, input: unknown): Promise<void> {
    requireStaff(context, 'corpus:review');
    if (context.principal.kind !== 'user') throw new IngestionFailure('input_invalid');
    const parsed = caseDetailsSchema.safeParse(input);
    if (!parsed.success) throw new IngestionFailure('input_invalid');
    const { taskId, courtId, decisionDate, neutralCitation, docketNumber } = parsed.data;
    const actorId = context.principal.userId;
    await this.assertSafe();
    try {
      await withPublicTransaction(this.pool, async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
          taskId,
          LOCK_NAMESPACE.review,
        ]);
        const task = await this.pendingVersion(tx, taskId);
        if (task.documentType !== 'case') throw new IngestionFailure('input_invalid');
        await corpusStore.recordCaseDetails(tx, {
          documentId: DocumentId.parse(task.documentId),
          jurisdictionId: JurisdictionId.parse(task.jurisdictionId),
          courtId: CourtId.parse(courtId),
          decisionDate,
          ...(neutralCitation === undefined ? {} : { neutralCitation }),
          ...(docketNumber === undefined ? {} : { docketNumber }),
        });
        await recordPlatformAuditEvent(tx, {
          actorKind: 'user',
          actorId,
          action: 'ingestion.case_details_recorded',
          outcome: 'success',
          resourceType: 'review_task',
          resourceId: taskId,
          metadata: {},
        });
      });
    } catch (error) {
      throw isAppError(error) || error instanceof IngestionFailure
        ? error
        : new IngestionFailure(failureCategory(error));
    }
  }

  /** The version a task is about, provided it is awaiting review. Anything else is not editable. */
  private async pendingVersion(tx: Tx, taskId: string) {
    const found = await tx.query<{
      version_id: string | null;
      job_status: string;
      document_id: string;
      jurisdiction_id: string;
      document_type: string;
    }>(
      `SELECT t.version_id, j.status AS job_status, v.document_id, v.jurisdiction_id, d.document_type
         FROM ingestion.review_tasks t
         JOIN ingestion.jobs j ON j.id = t.job_id
         LEFT JOIN corpus.document_versions v ON v.id = t.version_id
         LEFT JOIN corpus.legal_documents d ON d.id = v.document_id
        WHERE t.id = $1`,
      [taskId],
    );
    const row = found.rows[0];
    if (row?.version_id == null) throw new IngestionFailure('input_invalid');
    if (row.job_status !== 'pending_review') throw new IngestionFailure('validation_failed');
    return {
      versionId: row.version_id,
      documentId: row.document_id,
      jurisdictionId: row.jurisdiction_id,
      documentType: row.document_type,
    };
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
          `SELECT t.version_id, j.status AS job_status, j.source_id, j.actor_id AS requester_id,
                  EXISTS(SELECT 1 FROM ingestion.review_decisions d
                          WHERE d.task_id=t.id AND d.decision IN ('approve','reject')) AS decided
             FROM ingestion.review_tasks t JOIN ingestion.jobs j ON j.id=t.job_id WHERE t.id=$1`,
          [taskId],
        );
        const task = found.rows[0];
        // The first approval or rejection closes a task. The database refuses a second one as
        // well; this says so before anything is written.
        if (task === undefined || task.decided) throw new IngestionFailure('input_invalid');
        // Whoever requested the ingestion cannot approve it, even holding both permissions. The
        // database refuses too (ingestion migration 0002); this says so before anything is
        // written. Rejecting and holding are not blocked: neither can put anything in front of a
        // user.
        if (decision === 'approve' && task.requester_id === actorId) throw requesterCannotApprove();

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
      throw translateReviewError(error);
    }
  }
}
