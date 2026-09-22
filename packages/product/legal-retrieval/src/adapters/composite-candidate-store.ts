import type {
  AuthorizedRetrievalScope,
  RetrievalQuery,
  RetrievalSourceKind,
} from '../domain/retrieval.js';

import type {
  RetrievalCandidate,
  RetrievalCandidateStore,
} from '../ports/retrieval-candidate-store.js';

export interface CompositeRetrievalCandidateStoreInput {
  readonly corpus: RetrievalCandidateStore;
  readonly privateSources: RetrievalCandidateStore;
}

/**
 * Server-side dispatcher for the three Phase 8 evidence kinds.
 *
 * This deliberately does not merge unrestricted/global searches.
 *
 * Corpus candidates are produced only by the rights-aware public corpus store.
 * Knowledge and Matter candidates are produced only by the tenant/RLS-aware
 * private store.
 *
 * Authorization of each exact candidate remains the responsibility of the
 * AuthorizedRetrievalSource adapter and its WorkProductRevisionSourceReader.
 */
export class CompositeRetrievalCandidateStore
  implements RetrievalCandidateStore
{
  constructor(
    private readonly stores:
      CompositeRetrievalCandidateStoreInput,
  ) {}

  searchCandidates(
    scope: AuthorizedRetrievalScope,
    query: RetrievalQuery,
    sourceKind: RetrievalSourceKind,
  ): Promise<readonly RetrievalCandidate[]> {
    if (
      sourceKind ===
      'corpus_document_version'
    ) {
      return this.stores.corpus
        .searchCandidates(
          scope,
          query,
          sourceKind,
        );
    }

    if (
      sourceKind ===
        'knowledge_source_version'
      || sourceKind ===
        'matter_document_version'
    ) {
      return this.stores.privateSources
        .searchCandidates(
          scope,
          query,
          sourceKind,
        );
    }

    return Promise.resolve([]);
  }
}
