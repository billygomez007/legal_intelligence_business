import assert from 'node:assert/strict';
import { it } from 'vitest';

import * as policy from '../src/index.js';

const review = (overrides: Partial<policy.RevisionReview> = {}): policy.RevisionReview => ({
  id: 'review-1',
  revisionId: 'revision-1',
  reviewerUserId: 'user-1',
  decision: 'approved',
  reason: null,
  ...overrides,
});

const draft = policy.createReviewState('revision-1');

const submitted = policy.submitReviewRevision(draft, 'revision-1');

const approved = policy.decideReviewRevision(submitted, 'revision-1', review());

const rejected = policy.decideReviewRevision(
  submitted,
  'revision-1',
  review({
    decision: 'rejected',
    reason: 'Revise the draft',
  }),
);

const archived = policy.archiveReviewState(approved, 'revision-1');

for (const invalid of ['', ' ', ' x', 'x ', 'x'.repeat(129)]) {
  it(`rejects an invalid identifier ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => policy.createReviewState(invalid), policy.WorkProductPolicyError);
  });
}

it('approves the submitted revision', () => {
  assert.equal(approved.status, 'approved');
});

it('rejects the submitted revision', () => {
  assert.equal(rejected.status, 'rejected');
});

it('identifies the exact approved revision', () => {
  assert.equal(policy.effectiveRevisionApproval(approved)?.revisionId, 'revision-1');
});

for (const state of [draft, submitted, rejected, archived]) {
  it(`has no effective approval in ${state.status}`, () => {
    assert.equal(policy.effectiveRevisionApproval(state), null);
  });
}

for (const state of [draft, submitted, approved, rejected]) {
  it(`creates an unapproved new revision from ${state.status}`, () => {
    const next = policy.addReviewRevision(state, 'revision-1', 'revision-2');

    assert.equal(next.status, 'draft');
    assert.equal(next.submittedRevisionId, null);
    assert.equal(policy.effectiveRevisionApproval(next), null);
    assert.deepEqual(next.reviews, state.reviews);
  });

  it(`rejects a stale revision when advancing from ${state.status}`, () => {
    assert.throws(() => policy.addReviewRevision(state, 'wrong', 'revision-2'), {
      code: 'work_product.stale_revision',
    });
  });

  it(`refuses to reuse a revision ID from ${state.status}`, () => {
    assert.throws(() => policy.addReviewRevision(state, 'revision-1', 'revision-1'), {
      code: 'work_product.revision_already_exists',
    });
  });

  it(`archives a ${state.status} work product`, () => {
    assert.equal(policy.archiveReviewState(state, 'revision-1').status, 'archived');
  });
}

const archivedActions: readonly (readonly [string, () => unknown])[] = [
  ['submit', () => policy.submitReviewRevision(archived, 'revision-1')],
  ['revise', () => policy.addReviewRevision(archived, 'revision-1', 'revision-2')],
  ['decide', () => policy.decideReviewRevision(archived, 'revision-1', review())],
  ['archive again', () => policy.archiveReviewState(archived, 'revision-1')],
];

for (const [name, action] of archivedActions) {
  it(`cannot ${name} after archival`, () => {
    assert.throws(action, {
      code: 'work_product.archived',
    });
  });
}

for (const state of [draft, approved, rejected]) {
  it(`refuses a review decision in ${state.status}`, () => {
    assert.throws(() => policy.decideReviewRevision(state, 'revision-1', review()), {
      code: 'work_product.not_submitted',
    });
  });
}

const invalidReviews: readonly (readonly [string, Record<string, unknown>])[] = [
  ['missing review ID', { id: '' }],
  ['missing reviewer ID', { reviewerUserId: '' }],
  ['wrong revision', { revisionId: 'wrong' }],
  ['unknown decision', { decision: 'pending' }],
  ['empty rejection reason', { decision: 'rejected', reason: ' ' }],
  ['oversized reason', { reason: 'x'.repeat(2001) }],
  ['non-string reason', { reason: 5 }],
];

for (const [name, overrides] of invalidReviews) {
  it(`rejects ${name}`, () => {
    const invalid = {
      ...review(),
      ...overrides,
    };

    assert.throws(
      () => policy.decideReviewRevision(submitted, 'revision-1', invalid),
      policy.WorkProductPolicyError,
    );
  });
}

it('preserves the old approval and freezes copied history', () => {
  const next = policy.addReviewRevision(approved, 'revision-1', 'revision-2');

  assert.equal(approved.status, 'approved');
  assert.deepEqual(next.reviews, approved.reviews);

  assert.ok(Object.isFrozen(next));
  assert.ok(Object.isFrozen(next.revisionIds));
  assert.ok(Object.isFrozen(next.reviews));
  assert.ok(Object.isFrozen(next.reviews[0]));
});

it('requires a separate decision for a later revision and prevents duplicate review IDs', () => {
  const next = policy.addReviewRevision(approved, 'revision-1', 'revision-2');

  const ready = policy.submitReviewRevision(next, 'revision-2');

  assert.throws(
    () => policy.decideReviewRevision(ready, 'revision-2', review({ revisionId: 'revision-2' })),
    { code: 'work_product.review_already_exists' },
  );

  const decided = policy.decideReviewRevision(
    ready,
    'revision-2',
    review({
      id: 'review-2',
      revisionId: 'revision-2',
    }),
  );

  assert.equal(decided.reviews.length, 2);
  assert.equal(policy.effectiveRevisionApproval(decided)?.id, 'review-2');
});
