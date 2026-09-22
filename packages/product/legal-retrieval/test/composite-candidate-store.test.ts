import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  RetrievalCandidateStore,
} from '../src/ports/retrieval-candidate-store.js';

import {
  CompositeRetrievalCandidateStore,
  prepareRetrievalQuery,
  type AuthorizedRetrievalScope,
} from '../src/index.js';

const scope:
  AuthorizedRetrievalScope = {
    organizationId:
      '00000000-0000-4000-8000-000000000001',
    taskId:
      '00000000-0000-4000-8000-000000000002',
    taskScopeRevision:
      1,
    jurisdictionId:
      '00000000-0000-4000-8000-000000000003',
    countryCode:
      'GH',
    matterId:
      '00000000-0000-4000-8000-000000000004',
    scopeMode:
      'ghana_corpus_and_matter_and_firm_knowledge',
  };

const query =
  prepareRetrievalQuery({
    text:
      'employment contract',
  });

function store() {
  return {
    searchCandidates:
      vi.fn().mockResolvedValue([]),
  } satisfies RetrievalCandidateStore;
}

describe(
  'CompositeRetrievalCandidateStore',
  () => {
    it(
      'routes corpus only to the corpus candidate store',
      async () => {
        const corpus =
          store();

        const privateSources =
          store();

        const composite =
          new CompositeRetrievalCandidateStore({
            corpus,
            privateSources,
          });

        await composite.searchCandidates(
          scope,
          query,
          'corpus_document_version',
        );

        expect(
          corpus.searchCandidates,
        ).toHaveBeenCalledTimes(1);

        expect(
          privateSources.searchCandidates,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      'knowledge_source_version',
      'matter_document_version',
    ] as const)(
      'routes %s only to the private candidate store',
      async (kind) => {
        const corpus =
          store();

        const privateSources =
          store();

        const composite =
          new CompositeRetrievalCandidateStore({
            corpus,
            privateSources,
          });

        await composite.searchCandidates(
          scope,
          query,
          kind,
        );

        expect(
          privateSources.searchCandidates,
        ).toHaveBeenCalledWith(
          scope,
          query,
          kind,
        );

        expect(
          corpus.searchCandidates,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
