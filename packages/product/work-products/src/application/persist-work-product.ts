import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import { requireWorkProductPermission } from '../authz/require-permission.js';

import type {
  AppendWorkProductRevisionStoreInput,
  CreateWorkProductStoreInput,
  RecordWorkProductReviewStoreInput,
  StoredWorkProduct,
  StoredWorkProductReview,
  StoredWorkProductRevision,
  WorkProductStore,
} from '../ports/work-product-store.js';

import { auditWorkProductMutation } from './work-product-audit.js';

function organizationId(context: AuthzContext): string {
  return context.organizationId ?? '';
}

export type CreatePersistentWorkProductInput = Omit<CreateWorkProductStoreInput, 'createdBy'>;

export type AppendPersistentRevisionInput = Omit<AppendWorkProductRevisionStoreInput, 'createdBy'>;

export type RecordPersistentReviewInput = Omit<RecordWorkProductReviewStoreInput, 'decidedBy'>;

/**
 * Creates the durable aggregate.
 * Caller-supplied actor identity is deliberately impossible: the authenticated
 * user ID comes from the IAM context.
 */
export async function createPersistentWorkProduct(
  store: WorkProductStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  input: CreatePersistentWorkProductInput,
): Promise<StoredWorkProduct> {
  const actor = requireWorkProductPermission(
    context,
    organizationId(context),
    'work_product:create',
  );

  const created = await store.createWorkProduct(tx, {
    ...input,
    createdBy: actor,
  });

  await auditWorkProductMutation(tx, context, {
    action: 'work_product.created',
    resourceType: 'work_product',
    resourceId: created.id,
    metadata: {
      ai_task_id: created.aiTaskId,
      has_matter: created.matterId !== null,
      kind: created.kind,
    },
  });

  return created;
}

/**
 * Persists a previously prepared/authorized immutable content revision.
 *
 * Source authorization and cryptographic preparation happen before this
 * function. This function binds persistence to the authenticated actor and
 * writes a content-free audit record in the same transaction.
 */
export async function appendPersistentWorkProductRevision(
  store: WorkProductStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  input: AppendPersistentRevisionInput,
): Promise<StoredWorkProductRevision> {
  const actor = requireWorkProductPermission(
    context,
    organizationId(context),
    'work_product:revise',
  );

  const revision = await store.appendRevision(tx, {
    ...input,
    createdBy: actor,
  });

  await auditWorkProductMutation(tx, context, {
    action: 'work_product.revision_created',
    resourceType: 'work_product_revision',
    resourceId: revision.id,
    metadata: {
      work_product_id: revision.workProductId,
      revision_number: revision.revisionNumber,
      task_scope_revision: revision.taskScopeRevision,
      provenance_count: input.provenance.length,
    },
  });

  return revision;
}

export async function submitPersistentWorkProductRevision(
  store: WorkProductStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  workProductId: string,
  revisionId: string,
): Promise<StoredWorkProduct | null> {
  requireWorkProductPermission(context, organizationId(context), 'work_product:submit');

  const submitted = await store.submitRevision(tx, workProductId, revisionId);

  if (submitted === null) {
    return null;
  }

  await auditWorkProductMutation(tx, context, {
    action: 'work_product.submitted',
    resourceType: 'work_product',
    resourceId: submitted.id,
    metadata: {
      revision_id: revisionId,
    },
  });

  return submitted;
}

/**
 * Human-only approval/rejection.
 *
 * The reviewer identity is always taken from AuthzContext and cannot be
 * supplied by the request body.
 */
export async function recordPersistentWorkProductReview(
  store: WorkProductStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  input: RecordPersistentReviewInput,
): Promise<StoredWorkProductReview | null> {
  const permission = input.decision === 'approved' ? 'work_product:approve' : 'work_product:reject';

  const actor = requireWorkProductPermission(context, organizationId(context), permission);

  const review = await store.recordReview(tx, {
    ...input,
    decidedBy: actor,
  });

  if (review === null) {
    return null;
  }

  await auditWorkProductMutation(tx, context, {
    action: review.decision === 'approved' ? 'work_product.approved' : 'work_product.rejected',
    resourceType: 'work_product',
    resourceId: review.workProductId,
    metadata: {
      revision_id: review.revisionId,
      decision: review.decision,
    },
  });

  return review;
}

export async function archivePersistentWorkProduct(
  store: WorkProductStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  workProductId: string,
): Promise<StoredWorkProduct | null> {
  requireWorkProductPermission(context, organizationId(context), 'work_product:archive');

  const archived = await store.archiveWorkProduct(tx, workProductId);

  if (archived === null) {
    return null;
  }

  await auditWorkProductMutation(tx, context, {
    action: 'work_product.archived',
    resourceType: 'work_product',
    resourceId: archived.id,
  });

  return archived;
}
