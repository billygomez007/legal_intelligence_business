import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

export type WorkProductAuditAction =
  | 'work_product.created'
  | 'work_product.revision_created'
  | 'work_product.submitted'
  | 'work_product.approved'
  | 'work_product.rejected'
  | 'work_product.archived';

function humanActor(context: AuthzContext): {
  readonly actorKind: 'user';
  readonly actorId: string;
} {
  if (context.principal.kind !== 'user') {
    throw new Error('work_product.human_actor_required');
  }

  return {
    actorKind: 'user',
    actorId: context.principal.userId,
  };
}

/**
 * Audit is intentionally written through the caller's Tx.
 * Therefore a mutation and its audit row commit or roll back together.
 *
 * Metadata must contain identifiers/counts/statuses only—never Work Product
 * content, review prose, source text, document text, or model output.
 */
export async function auditWorkProductMutation(
  tx: Tx,
  context: AuthzContext,
  input: {
    readonly action: WorkProductAuditAction;
    readonly resourceType: 'work_product' | 'work_product_revision';
    readonly resourceId: string;
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  },
): Promise<void> {
  await recordAuditEvent(tx, {
    ...humanActor(context),
    action: input.action,
    outcome: 'success',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ?? {},
  });
}
