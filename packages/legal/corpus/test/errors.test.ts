import { describe, expect, it } from 'vitest';

import { mapCorpusError } from '../src';

/**
 * Database refusals reach callers as typed errors with fixed messages: a stable `code` to act on,
 * and never the driver's words, which can quote table names, constraint names and values.
 */
const raw = (fields: Record<string, string>) =>
  Object.assign(new Error('duplicate key value violates unique constraint "secret_table_key"'), {
    code: 'P0001',
    ...fields,
  });

describe('the integrity controls of corpus 0004 are reported with typed errors', () => {
  it.each([
    ['corpus.metadata_unverified', 'precondition_failed'],
    ['corpus.provenance_required', 'precondition_failed'],
    ['corpus.verification_stale', 'precondition_failed'],
    ['corpus.field_not_applicable', 'validation'],
  ])('maps the hint %s to a typed %s error', (hint, kind) => {
    const mapped = mapCorpusError(raw({ hint }));
    expect(mapped).toMatchObject({ code: hint, kind });
  });

  it.each([
    ['23503', 'document_versions_supersedes_same_document', 'corpus.supersession_invalid'],
    ['23514', 'document_versions_not_self_superseding', 'corpus.supersession_invalid'],
    ['23503', 'attestation_matches_version', 'corpus.provenance_mismatch'],
  ])('maps %s on constraint %s to %s', (code, constraint, expected) => {
    expect(mapCorpusError(raw({ code, constraint }))).toMatchObject({
      kind: 'validation',
      code: expected,
    });
  });

  it('never lets the driver’s message, table names or constraint names through', () => {
    for (const fields of [
      { hint: 'corpus.metadata_unverified' },
      { hint: 'corpus.provenance_required' },
      { code: '23503', constraint: 'attestation_matches_version' },
      { code: '23503', constraint: 'document_versions_supersedes_same_document' },
    ]) {
      const mapped = mapCorpusError(raw(fields)) as Error;
      expect(mapped.message).not.toMatch(
        /secret_table_key|violates|constraint|attestation_matches|document_versions/i,
      );
    }
  });

  it('leaves an unrecognised refusal for the logger, as before', () => {
    const unknown = raw({ code: 'XX000' });
    expect(mapCorpusError(unknown)).toBe(unknown);
  });
});
