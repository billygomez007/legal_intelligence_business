import type {
  AuthorizedRetrievalScope,
  RetrievalEvidence,
  RetrievalQuery,
  RetrievalSourceKind,
} from '../domain/retrieval.js';

export interface RetrievalSourcePort {
  readonly kind: RetrievalSourceKind;

  /**
   * Search ONLY within candidates already eligible for this authorized scope.
   *
   * Implementations must not perform an unrestricted/global search and rely
   * on the application layer to hide forbidden results afterwards.
   */
  search(
    scope: AuthorizedRetrievalScope,
    query: RetrievalQuery,
  ): Promise<readonly RetrievalEvidence[]>;
}
