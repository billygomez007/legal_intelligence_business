export const workProductStatuses = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'archived',
] as const;

export type WorkProductStatus = (typeof workProductStatuses)[number];

export type ReviewDecision = 'approved' | 'rejected';

export interface RevisionReview {
  readonly id: string;
  readonly revisionId: string;
  readonly reviewerUserId: string;
  readonly decision: ReviewDecision;
  readonly reason: string | null;
}

export interface WorkProductReviewState {
  readonly status: WorkProductStatus;
  readonly currentRevisionId: string;
  readonly revisionIds: readonly string[];
  readonly submittedRevisionId: string | null;
  readonly reviews: readonly RevisionReview[];
}

export class WorkProductPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'WorkProductPolicyError';
    this.code = code;
  }
}

function reject(code: string): never {
  throw new WorkProductPolicyError(code);
}

function identifier(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    reject('work_product.invalid_identifier');
  }

  return value;
}

function freezeState(state: WorkProductReviewState): WorkProductReviewState {
  return Object.freeze({
    ...state,
    revisionIds: Object.freeze([...state.revisionIds]),
    reviews: Object.freeze(state.reviews.map((review) => Object.freeze({ ...review }))),
  });
}

function requireCurrent(state: WorkProductReviewState, expectedRevisionId: string): void {
  identifier(expectedRevisionId);

  if (state.currentRevisionId !== expectedRevisionId) {
    reject('work_product.stale_revision');
  }

  if (state.status === 'archived') {
    reject('work_product.archived');
  }
}

/** Pure domain state only. No persistence or authorization is performed here. */
export function createReviewState(revisionId: string): WorkProductReviewState {
  identifier(revisionId);

  return freezeState({
    status: 'draft',
    currentRevisionId: revisionId,
    revisionIds: [revisionId],
    submittedRevisionId: null,
    reviews: [],
  });
}

/** A new revision supersedes the current submission/approval, not its history. */
export function addReviewRevision(
  state: WorkProductReviewState,
  expectedRevisionId: string,
  newRevisionId: string,
): WorkProductReviewState {
  requireCurrent(state, expectedRevisionId);
  identifier(newRevisionId);

  if (state.revisionIds.includes(newRevisionId)) {
    reject('work_product.revision_already_exists');
  }

  return freezeState({
    ...state,
    status: 'draft',
    currentRevisionId: newRevisionId,
    revisionIds: [...state.revisionIds, newRevisionId],
    submittedRevisionId: null,
  });
}

export function submitReviewRevision(
  state: WorkProductReviewState,
  expectedRevisionId: string,
): WorkProductReviewState {
  requireCurrent(state, expectedRevisionId);

  if (state.status !== 'draft') {
    reject('work_product.not_draft');
  }

  return freezeState({
    ...state,
    status: 'submitted',
    submittedRevisionId: state.currentRevisionId,
  });
}

/** Caller must first authenticate/authorize the reviewer through existing IAM. */
export function decideReviewRevision(
  state: WorkProductReviewState,
  expectedRevisionId: string,
  review: RevisionReview,
): WorkProductReviewState {
  requireCurrent(state, expectedRevisionId);

  if (state.status !== 'submitted' || state.submittedRevisionId !== expectedRevisionId) {
    reject('work_product.not_submitted');
  }

  identifier(review.id);
  identifier(review.revisionId);
  identifier(review.reviewerUserId);

  if (review.revisionId !== expectedRevisionId) {
    reject('work_product.review_revision_mismatch');
  }

  if (state.reviews.some((item) => item.id === review.id)) {
    reject('work_product.review_already_exists');
  }

  if (
    review.decision !== 'approved' &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate runtime inputs and database results even when their declared types are narrower.
    review.decision !== 'rejected'
  ) {
    reject('work_product.invalid_decision');
  }

  if (review.reason !== null && typeof review.reason !== 'string') {
    reject('work_product.invalid_reason');
  }

  const reason = review.reason === null ? null : review.reason.trim() || null;

  if (reason !== null && reason.length > 2000) {
    reject('work_product.reason_too_long');
  }

  if (review.decision === 'rejected' && reason === null) {
    reject('work_product.rejection_reason_required');
  }

  return freezeState({
    ...state,
    status: review.decision,
    submittedRevisionId: null,
    reviews: [...state.reviews, { ...review, reason }],
  });
}

export function archiveReviewState(
  state: WorkProductReviewState,
  expectedRevisionId: string,
): WorkProductReviewState {
  requireCurrent(state, expectedRevisionId);

  return freezeState({
    ...state,
    status: 'archived',
    submittedRevisionId: null,
  });
}

export function effectiveRevisionApproval(state: WorkProductReviewState): RevisionReview | null {
  if (state.status !== 'approved') {
    return null;
  }

  for (let index = state.reviews.length - 1; index >= 0; index -= 1) {
    const review = state.reviews[index];

    if (review?.revisionId === state.currentRevisionId) {
      return review.decision === 'approved' ? review : null;
    }
  }

  return null;
}
