import type { AuthzContext } from '@legalintel/iam';

import { requireWorkProductPermission } from '../authz/require-permission.js';

import {
  decideReviewRevision,
  WorkProductPolicyError,
  type RevisionReview,
  type WorkProductReviewState,
} from '../domain/review-policy.js';

export type WorkProductReviewRequest = Omit<RevisionReview, 'reviewerUserId'>;

/** Pure authorized transition; persistence and audit are not performed here. */
export function reviewWorkProductRevision(
  context: AuthzContext,
  resourceOrganizationId: string,
  state: WorkProductReviewState,
  expectedRevisionId: string,
  request: WorkProductReviewRequest,
): WorkProductReviewState {
  if (
    request.decision !== 'approved' &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate runtime inputs and database results even when their declared types are narrower.
    request.decision !== 'rejected'
  ) {
    throw new WorkProductPolicyError('work_product.invalid_decision');
  }

  const reviewerUserId = requireWorkProductPermission(
    context,
    resourceOrganizationId,
    request.decision === 'approved' ? 'work_product:approve' : 'work_product:reject',
  );

  // Do not spread request: a supplied reviewer identity is never trusted.
  return decideReviewRevision(state, expectedRevisionId, {
    id: request.id,
    revisionId: request.revisionId,
    decision: request.decision,
    reason: request.reason,
    reviewerUserId,
  });
}
