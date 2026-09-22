export interface LegalResearchCitation {
  readonly evidenceOrdinal: number;

  readonly sourceKind: string;

  readonly sourceId: string;

  readonly versionId: string;

  readonly passageId: string | null;

  readonly locator: string | null;
}

export interface LegalResearchProposition {
  readonly text: string;

  readonly citations: readonly LegalResearchCitation[];
}

export interface LegalResearchResult {
  /**
   * Original user question.
   *
   * This is intentionally separate from the normalized retrieval query.
   */
  readonly question: string;

  readonly summary: string;

  readonly propositions: readonly LegalResearchProposition[];

  readonly unresolvedIssues: readonly string[];

  readonly insufficientEvidence: boolean;

  /**
   * Explicit trust statement for the application/UI.
   *
   * AI output is research assistance, not authoritative legal source material.
   */
  readonly authoritativeLegalSource: false;

  /**
   * Human review remains mandatory before a Work Product can be approved.
   */
  readonly humanReviewRequired: true;
}
