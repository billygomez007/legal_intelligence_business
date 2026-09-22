import { describe, expect, it } from 'vitest';

import { deriveLegalRetrievalQuery, researchQueryLimits } from '../src/domain/research-query.js';

describe('Phase 9I deterministic legal retrieval query derivation', () => {
  it('turns a normal Ghana legal question into focused lexical terms', () => {
    expect(deriveLegalRetrievalQuery('What does Ghanaian law say about equitable estoppel?')).toBe(
      'equitable estoppel',
    );
  });

  it('preserves substantive legal terminology without inventing terms', () => {
    expect(
      deriveLegalRetrievalQuery(
        'Under Ghanaian law, when can promissory estoppel prevent strict enforcement of a contract?',
      ),
    ).toBe('promissory estoppel prevent strict enforcement contract');
  });

  it('normalizes Unicode and repeated whitespace deterministically', () => {
    expect(
      deriveLegalRetrievalQuery(
        '  What   does   Ghanaian   law   say   about   EQUITABLE   ESTOPPEL?  ',
      ),
    ).toBe('equitable estoppel');
  });

  it('does not add jurisdiction, source, matter or authority terms', () => {
    const derived = deriveLegalRetrievalQuery(
      'What are the limitation periods for breach of contract?',
    );

    expect(derived).toBe('limitation periods breach contract');

    expect(derived).not.toContain('court');

    expect(derived).not.toContain('statute');

    expect(derived).not.toContain('case');
  });

  it('falls back without inventing content when every word is boilerplate', () => {
    expect(deriveLegalRetrievalQuery('What is the law?')).toBe('what is the law');
  });

  it('is deterministic', () => {
    const question = 'What does Ghanaian law say about equitable estoppel?';

    expect(deriveLegalRetrievalQuery(question)).toBe(deriveLegalRetrievalQuery(question));
  });

  it('bounds the derived query by terms and UTF-8 bytes', () => {
    const query = Array.from(
      {
        length: 200,
      },
      (_, index) => `authority${index}`,
    ).join(' ');

    const derived = deriveLegalRetrievalQuery(query);

    expect(derived.split(' ').length).toBeLessThanOrEqual(researchQueryLimits.maxTerms);

    expect(Buffer.byteLength(derived, 'utf8')).toBeLessThanOrEqual(researchQueryLimits.maxBytes);
  });

  it('does not mutate the caller question', () => {
    const question = 'What does Ghanaian law say about equitable estoppel?';

    deriveLegalRetrievalQuery(question);

    expect(question).toBe('What does Ghanaian law say about equitable estoppel?');
  });
});
