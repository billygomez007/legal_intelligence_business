import { forbidden } from '@legalintel/kernel';
import { describe, expect, it } from 'vitest';

import {
  failureCategory,
  IngestionFailure,
  REQUESTER_CANNOT_APPROVE,
  translateReviewError,
} from '../src';

/**
 * What a caller sees when a review decision is refused. The database is the enforcer; the
 * adapter's job is to turn its refusals into typed, fixed-message errors and never pass its words
 * on. The requester rule reaches here through two doors (the adapter's own check, and the
 * database's trigger if something reaches it without asking), and both must look the same.
 */
const databaseError = (fields: Record<string, string>) =>
  Object.assign(new Error('insert or update on table "review_decisions" violates …'), {
    code: 'P0001',
    ...fields,
  });

describe('translateReviewError', () => {
  it('reports the database’s requester refusal as the same typed error as the adapter’s own', () => {
    const fromDatabase = translateReviewError(
      databaseError({ hint: 'ingestion.requester_cannot_approve' }),
    );
    expect(fromDatabase).toMatchObject({ kind: 'forbidden', code: REQUESTER_CANNOT_APPROVE });
    expect((fromDatabase as Error).message).not.toMatch(
      /review_decisions|violates|insert or update/,
    );
  });

  it('lets the adapter’s own typed refusal through unchanged', () => {
    const own = forbidden(REQUESTER_CANNOT_APPROVE, 'fixed message');
    expect(translateReviewError(own)).toBe(own);
  });

  it('lets an ingestion failure through unchanged', () => {
    const failure = new IngestionFailure('input_invalid');
    expect(translateReviewError(failure)).toBe(failure);
  });

  it('turns anything else into a category, never the database’s words', () => {
    const result = translateReviewError(databaseError({ hint: 'corpus.metadata_unverified' }));
    expect(result).toBeInstanceOf(IngestionFailure);
    expect(result).toMatchObject({ category: 'validation_failed' });
    expect(translateReviewError(new Error('boom'))).toMatchObject({ category: 'internal_error' });
  });
});

describe('failure categories for the integrity controls', () => {
  it.each([
    ['corpus.metadata_unverified', 'validation_failed'],
    ['corpus.provenance_required', 'validation_failed'],
    ['ingestion.attestation_not_ready', 'validation_failed'],
    ['ingestion.attestation_missing', 'validation_failed'],
  ])('classifies the hint %s as %s', (hint, category) => {
    expect(failureCategory(databaseError({ hint }))).toBe(category);
  });

  it('classifies the typed corpus errors the review path receives', () => {
    for (const code of ['corpus.metadata_unverified', 'corpus.provenance_required']) {
      expect(failureCategory(Object.assign(new Error('x'), { code }))).toBe('validation_failed');
    }
  });
});
