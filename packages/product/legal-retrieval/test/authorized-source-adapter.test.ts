import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import type {
  AuthzContext,
} from '@legalintel/iam';

import type {
  WorkProductRevisionSourceReader,
} from '@legalintel/work-products';

import {
  createAuthorizedRetrievalSource,
  type AuthorizedRetrievalScope,
  type RetrievalCandidateStore,
  type RetrievalQuery,
  type RetrievalSourceKind,
} from '../src/index.js';

const context = {
  principal: {
    kind: 'user',
    userId: 'user-A',
  },
  organizationId: 'org-A',
  roles: ['owner'],
  permissions: new Set([
    'work_product:read',
  ]),
} as unknown as AuthzContext;

const scope:
  AuthorizedRetrievalScope = {
    organizationId:
      'org-A',
    taskId:
      'task-A',
    taskScopeRevision:
      1,
    jurisdictionId:
      '00000000-0000-4000-8000-000000000001',
    countryCode:
      'GH',
    matterId:
      'matter-A',
    scopeMode:
      'matter',
  };

const query:
  RetrievalQuery = {
    text:
      'contract law',
    normalizedText:
      'contract law',
    fingerprint:
      'a'.repeat(64),
    limit:
      10,
  };

function fixture(
  kind:
    RetrievalSourceKind =
      'corpus_document_version',
) {
  const state = {
    authorized:
      true,
    searchedKind:
      null as RetrievalSourceKind | null,
    searchedScope:
      null as AuthorizedRetrievalScope | null,
    readCount:
      0,
  };

  const store:
    RetrievalCandidateStore = {
      async searchCandidates(
        actualScope,
        actualQuery,
        actualKind,
      ) {
        state.searchedScope =
          actualScope;
        state.searchedKind =
          actualKind;

        assert.equal(
          actualQuery,
          query,
        );

        return [
          {
            sourceKind:
              actualKind,
            sourceId:
              '00000000-0000-4000-8000-000000000101',
            versionId:
              '00000000-0000-4000-8000-000000000102',
            passageId:
              '00000000-0000-4000-8000-000000000103',
            locator:
              'page 4',
            contentHash:
              'b'.repeat(64),
            score:
              0.9,
            stableKey:
              '001',
            excerpt:
              'Authorized excerpt',
          },
        ];
      },
    };

  const reader = {
    async readScope() {
      throw new Error(
        'not used',
      );
    },

    async readSource(
      _context: AuthzContext,
      actualScope: Parameters<
        WorkProductRevisionSourceReader['readSource']
      >[1],
      reference: Parameters<
        WorkProductRevisionSourceReader['readSource']
      >[2],
    ) {
      state.readCount += 1;

      assert.equal(
        actualScope.organizationId,
        'org-A',
      );

      assert.equal(
        actualScope.taskScopeRevision,
        1,
      );

      assert.equal(
        reference.kind,
        kind,
      );

      if (!state.authorized) {
        return null;
      }

      return {
        kind:
          reference.kind,
        sourceId:
          reference.sourceId,
        versionId:
          reference.versionId,
        organizationId:
          kind ===
          'corpus_document_version'
            ? null
            : 'org-A',
        matterId:
          kind ===
          'matter_document_version'
            ? 'matter-A'
            : null,
        countryCode:
          'GH',
        permitted:
          true,
      };
    },
  } as WorkProductRevisionSourceReader;

  const adapter =
    createAuthorizedRetrievalSource(
      kind,
      {
        context,
        sourceReader:
          reader,
        candidateStore:
          store,
      },
    );

  return {
    state,
    adapter,
  };
}

for (const kind of [
  'corpus_document_version',
  'knowledge_source_version',
  'matter_document_version',
] as const) {
  it(
    `returns only Phase 7-authorized ${kind} evidence`,
    async () => {
      const {
        state,
        adapter,
      } = fixture(kind);

      const result =
        await adapter.search(
          scope,
          query,
        );

      assert.equal(
        result.length,
        1,
      );

      assert.equal(
        result[0]?.source.kind,
        kind,
      );

      assert.equal(
        result[0]?.excerpt,
        'Authorized excerpt',
      );

      assert.equal(
        state.readCount,
        1,
      );

      assert.equal(
        state.searchedKind,
        kind,
      );

      assert.equal(
        state.searchedScope,
        scope,
      );
    },
  );
}

it(
  'drops candidate when exact source authorization fails',
  async () => {
    const {
      state,
      adapter,
    } = fixture();

    state.authorized =
      false;

    const result =
      await adapter.search(
        scope,
        query,
      );

    assert.deepEqual(
      result,
      [],
    );
  },
);

it(
  'never exposes candidate excerpt before source authorization succeeds',
  async () => {
    const {
      state,
      adapter,
    } = fixture(
      'matter_document_version',
    );

    state.authorized =
      false;

    const result =
      await adapter.search(
        scope,
        query,
      );

    assert.equal(
      result.length,
      0,
    );
  },
);

it(
  'fails closed when candidate source kind does not match adapter',
  async () => {
    const {
      adapter,
    } = fixture();

    const badStore:
      RetrievalCandidateStore = {
        async searchCandidates() {
          return [{
            sourceKind:
              'knowledge_source_version',
            sourceId:
              '00000000-0000-4000-8000-000000000201',
            versionId:
              '00000000-0000-4000-8000-000000000202',
            passageId:
              null,
            locator:
              null,
            contentHash:
              null,
            score:
              1,
            stableKey:
              'bad',
            excerpt:
              'must not leak',
          }];
        },
      };

    const result =
      await createAuthorizedRetrievalSource(
        'corpus_document_version',
        {
          context,
          sourceReader: {
            async readScope() {
              throw new Error(
                'not used',
              );
            },

            async readSource() {
              throw new Error(
                'must not authorize mismatched kind',
              );
            },
          } as WorkProductRevisionSourceReader,
          candidateStore:
            badStore,
        },
      ).search(
        scope,
        query,
      );

    assert.deepEqual(
      result,
      [],
    );

    assert.equal(
      adapter.kind,
      'corpus_document_version',
    );
  },
);

it(
  'fails closed on non-finite search score before source exposure',
  async () => {
    const reader = {
      async readScope() {
        throw new Error(
          'not used',
        );
      },

      async readSource() {
        throw new Error(
          'must not be called',
        );
      },
    } as WorkProductRevisionSourceReader;

    const store:
      RetrievalCandidateStore = {
        async searchCandidates() {
          return [{
            sourceKind:
              'corpus_document_version',
            sourceId:
              '00000000-0000-4000-8000-000000000301',
            versionId:
              '00000000-0000-4000-8000-000000000302',
            passageId:
              null,
            locator:
              null,
            contentHash:
              null,
            score:
              Number.NaN,
            stableKey:
              'bad',
            excerpt:
              'must not leak',
          }];
        },
      };

    const result =
      await createAuthorizedRetrievalSource(
        'corpus_document_version',
        {
          context,
          sourceReader:
            reader,
          candidateStore:
            store,
        },
      ).search(
        scope,
        query,
      );

    assert.deepEqual(
      result,
      [],
    );
  },
);
