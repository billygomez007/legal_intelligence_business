import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import type { Tx } from '@legalintel/db';

import {
  PgCorpusRetrievalCandidateStore,
  type AuthorizedRetrievalScope,
  type RetrievalQuery,
} from '../src/index.js';

const scope:
  AuthorizedRetrievalScope = {
    organizationId:
      'org-A',
    taskId:
      'task-A',
    taskScopeRevision:
      1,
    jurisdictionId:
      '00000000-0000-4000-8000-000000000101',
    countryCode:
      'GH',
    matterId:
      null,
    scopeMode:
      'ghana_corpus',
  };

const query:
  RetrievalQuery = {
    text:
      'contract breach damages',
    normalizedText:
      'contract breach damages',
    fingerprint:
      'a'.repeat(64),
    limit:
      7,
  };

function fixture() {
  const state = {
    calls: [] as {
      sql: string;
      values: readonly unknown[];
    }[],
  };

  const tx = {
    async query(
      sql: string,
      values?: readonly unknown[],
    ) {
      state.calls.push({
        sql,
        values: values ?? [],
      });

      return {
        rows: [
          {
            source_id:
              '00000000-0000-4000-8000-000000000201',
            version_id:
              '00000000-0000-4000-8000-000000000202',
            passage_id:
              '00000000-0000-4000-8000-000000000203',
            locator:
              '¶12',
            score:
              0.75,
            stable_key:
              '00000000-0000-4000-8000-000000000203',
            excerpt:
              'A contractual breach may give rise to damages.',
          },
        ],
        rowCount: 1,
      };
    },
  } as unknown as Tx;

  return {
    state,
    store:
      new PgCorpusRetrievalCandidateStore(tx),
  };
}

it(
  'searches only published Ghana corpus passages with current ai_processing rights',
  async () => {
    const {
      state,
      store,
    } = fixture();

    const result =
      await store.searchCandidates(
        scope,
        query,
        'corpus_document_version',
      );

    assert.equal(
      state.calls.length,
      1,
    );

    const call =
      state.calls[0];

    assert.ok(call);

    assert.match(
      call.sql,
      /corpus\.passages/,
    );

    assert.match(
      call.sql,
      /corpus\.document_versions/,
    );

    assert.match(
      call.sql,
      /corpus\.legal_documents/,
    );

    assert.match(
      call.sql,
      /lifecycle_state\s*=\s*'published'/,
    );

    assert.match(
      call.sql,
      /corpus\.source_allows/,
    );

    assert.match(
      call.sql,
      /'ai_processing'/,
    );

    assert.match(
      call.sql,
      /jurisdiction_id/,
    );

    assert.match(
      call.sql,
      /websearch_to_tsquery/,
    );

    assert.match(
      call.sql,
      /to_tsvector/,
    );

    assert.deepEqual(
      call.values,
      [
        'contract breach damages',
        scope.jurisdictionId,
        7,
      ],
    );

    assert.deepEqual(
      result,
      [
        {
          sourceKind:
            'corpus_document_version',
          sourceId:
            '00000000-0000-4000-8000-000000000201',
          versionId:
            '00000000-0000-4000-8000-000000000202',
          passageId:
            '00000000-0000-4000-8000-000000000203',
          locator:
            '¶12',
          contentHash:
            null,
          score:
            0.75,
          stableKey:
            '00000000-0000-4000-8000-000000000203',
          excerpt:
            'A contractual breach may give rise to damages.',
        },
      ],
    );
  },
);

it(
  'returns no candidates for a private-source adapter request',
  async () => {
    const {
      state,
      store,
    } = fixture();

    assert.deepEqual(
      await store.searchCandidates(
        scope,
        query,
        'knowledge_source_version',
      ),
      [],
    );

    assert.deepEqual(
      await store.searchCandidates(
        scope,
        query,
        'matter_document_version',
      ),
      [],
    );

    assert.equal(
      state.calls.length,
      0,
    );
  },
);

it(
  'fails closed for a non-Ghana scope',
  async () => {
    const {
      state,
      store,
    } = fixture();

    assert.deepEqual(
      await store.searchCandidates(
        {
          ...scope,
          countryCode:
            'NG' as 'GH',
        },
        query,
        'corpus_document_version',
      ),
      [],
    );

    assert.equal(
      state.calls.length,
      0,
    );
  },
);

it(
  'drops non-finite database scores',
  async () => {
    const tx = {
      async query() {
        return {
          rows: [
            {
              source_id:
                '00000000-0000-4000-8000-000000000301',
              version_id:
                '00000000-0000-4000-8000-000000000302',
              passage_id:
                '00000000-0000-4000-8000-000000000303',
              locator:
                null,
              score:
                'NaN',
              stable_key:
                'x',
              excerpt:
                'must not escape',
            },
          ],
          rowCount: 1,
        };
      },
    } as unknown as Tx;

    const store =
      new PgCorpusRetrievalCandidateStore(
        tx,
      );

    assert.deepEqual(
      await store.searchCandidates(
        scope,
        query,
        'corpus_document_version',
      ),
      [],
    );
  },
);

it(
  'accepts PostgreSQL numeric score strings safely',
  async () => {
    const tx = {
      async query() {
        return {
          rows: [
            {
              source_id:
                '00000000-0000-4000-8000-000000000401',
              version_id:
                '00000000-0000-4000-8000-000000000402',
              passage_id:
                '00000000-0000-4000-8000-000000000403',
              locator:
                '¶1',
              score:
                '0.42',
              stable_key:
                'stable',
              excerpt:
                'Evidence',
            },
          ],
          rowCount: 1,
        };
      },
    } as unknown as Tx;

    const [candidate] =
      await new PgCorpusRetrievalCandidateStore(
        tx,
      ).searchCandidates(
        scope,
        query,
        'corpus_document_version',
      );

    assert.equal(
      candidate?.score,
      0.42,
    );
  },
);
