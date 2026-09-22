import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import {
  rankRetrievalEvidence,
  type RetrievalEvidence,
} from '../src/index.js';

function evidence(
  input: {
    sourceId: string;
    versionId?: string;
    passageId?: string;
    score: number;
    stableKey: string;
  },
): RetrievalEvidence {
  return {
    source: {
      kind:
        'corpus_document_version',
      sourceId: input.sourceId,
      versionId:
        input.versionId ?? 'v1',
    },

    passage:
      input.passageId === undefined
        ? null
        : {
            passageId:
              input.passageId,
            locator: null,
            contentHash: null,
          },

    score: input.score,
    stableKey: input.stableKey,
    excerpt: null,
  };
}

it('orders higher scores first', () => {
  const result =
    rankRetrievalEvidence(
      [
        evidence({
          sourceId: 'a',
          score: 1,
          stableKey: 'a',
        }),
        evidence({
          sourceId: 'b',
          score: 2,
          stableKey: 'b',
        }),
      ],
      10,
    );

  assert.deepEqual(
    result.map(
      (item) =>
        item.source.sourceId,
    ),
    ['b', 'a'],
  );
});

it('uses deterministic stable tie breaking', () => {
  const input = [
    evidence({
      sourceId: 'b',
      score: 1,
      stableKey: 'b',
    }),
    evidence({
      sourceId: 'a',
      score: 1,
      stableKey: 'a',
    }),
  ];

  const first =
    rankRetrievalEvidence(
      input,
      10,
    );

  const second =
    rankRetrievalEvidence(
      [...input].reverse(),
      10,
    );

  assert.deepEqual(
    first,
    second,
  );

  assert.deepEqual(
    first.map(
      (item) =>
        item.source.sourceId,
    ),
    ['a', 'b'],
  );
});

it('deduplicates identical exact evidence identity', () => {
  const result =
    rankRetrievalEvidence(
      [
        evidence({
          sourceId: 'a',
          passageId: 'p1',
          score: 1,
          stableKey: 'z',
        }),
        evidence({
          sourceId: 'a',
          passageId: 'p1',
          score: 2,
          stableKey: 'a',
        }),
      ],
      10,
    );

  assert.equal(
    result.length,
    1,
  );

  assert.equal(
    result[0]?.score,
    2,
  );
});

it('bounds result count', () => {
  const result =
    rankRetrievalEvidence(
      [
        evidence({
          sourceId: 'a',
          score: 3,
          stableKey: 'a',
        }),
        evidence({
          sourceId: 'b',
          score: 2,
          stableKey: 'b',
        }),
        evidence({
          sourceId: 'c',
          score: 1,
          stableKey: 'c',
        }),
      ],
      2,
    );

  assert.equal(
    result.length,
    2,
  );
});

it('rejects non-finite scores', () => {
  assert.throws(
    () =>
      rankRetrievalEvidence(
        [
          evidence({
            sourceId: 'a',
            score: Number.NaN,
            stableKey: 'a',
          }),
        ],
        10,
      ),
    /retrieval\.score_invalid/,
  );
});
