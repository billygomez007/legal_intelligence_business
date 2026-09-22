import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import {
  DEFAULT_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_QUERY_BYTES,
  prepareRetrievalQuery,
} from '../src/index.js';

it('normalizes equivalent whitespace deterministically', () => {
  const a = prepareRetrievalQuery({
    text: '  Ghana   contract   law ',
  });

  const b = prepareRetrievalQuery({
    text: 'Ghana contract law',
  });

  assert.equal(
    a.normalizedText,
    'Ghana contract law',
  );

  assert.equal(
    a.fingerprint,
    b.fingerprint,
  );
});

it('uses the default bounded limit', () => {
  assert.equal(
    prepareRetrievalQuery({
      text: 'contract',
    }).limit,
    DEFAULT_RETRIEVAL_LIMIT,
  );
});

for (const text of [
  '',
  ' ',
  '\n\t ',
]) {
  it('rejects empty or whitespace-only query', () => {
    assert.throws(
      () =>
        prepareRetrievalQuery({
          text,
        }),
      /retrieval\.query_empty/,
    );
  });
}

it('rejects null bytes', () => {
  assert.throws(
    () =>
      prepareRetrievalQuery({
        text: 'contract\0law',
      }),
    /retrieval\.query_null_byte/,
  );
});

it('rejects oversized queries', () => {
  assert.throws(
    () =>
      prepareRetrievalQuery({
        text:
          'x'.repeat(
            MAX_RETRIEVAL_QUERY_BYTES
            + 1,
          ),
      }),
    /retrieval\.query_too_large/,
  );
});

for (const limit of [
  0,
  -1,
  1.5,
  MAX_RETRIEVAL_LIMIT + 1,
  Number.NaN,
]) {
  it(`rejects invalid limit ${String(limit)}`, () => {
    assert.throws(
      () =>
        prepareRetrievalQuery({
          text: 'contract',
          limit,
        }),
      /retrieval\.limit_invalid/,
    );
  });
}
