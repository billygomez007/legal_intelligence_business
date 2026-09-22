import type {
  AuthorizedRetrievalScope,
  RetrievalQuery,
  RetrievalSourceKind,
} from '../domain/retrieval.js';

export interface RetrievalCandidate {
  readonly sourceKind: RetrievalSourceKind;
  readonly sourceId: string;
  readonly versionId: string;

  readonly passageId: string | null;
  readonly locator: string | null;
  readonly contentHash: string | null;

  /**
   * Search score only.
   * This value is not an authorization result.
   */
  readonly score: number;

  /**
   * Stable deterministic tie-break key.
   */
  readonly stableKey: string;

  /**
   * Candidate excerpt.
   * Adapters may expose it only after authorization succeeds.
   */
  readonly excerpt: string | null;
}

/**
 * Search implementations must already constrain SQL/candidate generation
 * using the supplied authorized task scope.
 *
 * The application layer will STILL authorize every exact returned source
 * before exposing it, providing defense in depth.
 */
export interface RetrievalCandidateStore {
  searchCandidates(
    scope: AuthorizedRetrievalScope,
    query: RetrievalQuery,
    sourceKind: RetrievalSourceKind,
  ): Promise<readonly RetrievalCandidate[]>;
}
