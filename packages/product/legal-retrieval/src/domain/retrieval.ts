export const RETRIEVAL_SOURCE_KINDS = [
  'corpus_document_version',
  'knowledge_source_version',
  'matter_document_version',
] as const;

export type RetrievalSourceKind =
  (typeof RETRIEVAL_SOURCE_KINDS)[number];

export const RETRIEVAL_MODES = [
  'research',
  'authority_lookup',
  'matter_research',
] as const;

export type RetrievalMode =
  (typeof RETRIEVAL_MODES)[number];

export interface ExactSourceVersionReference {
  readonly kind: RetrievalSourceKind;
  readonly sourceId: string;
  readonly versionId: string;
}

export interface RetrievalPassageReference {
  readonly passageId: string;
  readonly locator: string | null;
  readonly contentHash: string | null;
}

export interface AuthorizedRetrievalScope {
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskScopeRevision: number;
  readonly jurisdictionId: string;
  readonly countryCode: 'GH';
  readonly matterId: string | null;
  readonly scopeMode: string;
}

export interface RetrievalQuery {
  readonly text: string;
  readonly normalizedText: string;
  readonly fingerprint: string;
  readonly limit: number;
}

export interface RetrievalEvidence {
  readonly source: ExactSourceVersionReference;
  readonly passage: RetrievalPassageReference | null;

  /**
   * Deterministic ranking score.
   * Higher values sort before lower values.
   */
  readonly score: number;

  /**
   * Stable tie-break key. It must not contain unrestricted/private content.
   */
  readonly stableKey: string;

  /**
   * Optional evidence excerpt. Adapters may populate it only after the source
   * has passed the relevant authorization checks.
   */
  readonly excerpt: string | null;
}

export interface RetrievalResult {
  readonly scope: AuthorizedRetrievalScope;
  readonly query: RetrievalQuery;
  readonly evidence: readonly RetrievalEvidence[];
}

export interface GroundedResearchPacket {
  readonly question: string;
  readonly scope: AuthorizedRetrievalScope;
  readonly evidence: readonly RetrievalEvidence[];
  readonly unresolvedIssues: readonly string[];
  readonly insufficientEvidence: boolean;
}

export type RetrievalExclusionReason =
  | 'wrong_organization'
  | 'wrong_matter'
  | 'wrong_jurisdiction'
  | 'stale_task_scope'
  | 'task_not_ready'
  | 'source_inactive'
  | 'version_not_found'
  | 'not_published'
  | 'ai_processing_not_allowed'
  | 'permission_denied'
  | 'malformed_reference';
