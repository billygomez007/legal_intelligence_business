import type {
  RetrievalSourceKind,
} from '@legalintel/legal-retrieval';

export interface SynthesisEvidenceReference {
  readonly ordinal: number;

  readonly source: Readonly<{
    readonly kind: RetrievalSourceKind;
    readonly sourceId: string;
    readonly versionId: string;
  }>;

  readonly passageId: string | null;
  readonly locator: string | null;

  /**
   * Authorized evidence text supplied to the provider for this one generation.
   *
   * This is model context, not citation identity.
   * Durable citations are reconstructed from source/version identifiers.
   */
  readonly excerpt: string | null;
}

export interface LegalSynthesisProviderRequest {
  readonly question: string;
  readonly countryCode: 'GH';

  readonly evidence:
    readonly SynthesisEvidenceReference[];

  readonly unresolvedIssues:
    readonly string[];
}

/**
 * Provider output deliberately cannot supply source IDs, version IDs,
 * passage IDs or locators.
 *
 * It may reference only evidence ordinals already supplied by Law Afrique.
 */
export interface LegalSynthesisProviderProposition {
  readonly text: string;
  readonly evidenceOrdinals:
    readonly number[];
}

export interface LegalSynthesisProviderResult {
  readonly summary: string;

  readonly propositions:
    readonly LegalSynthesisProviderProposition[];

  readonly unresolvedIssues:
    readonly string[];

  readonly insufficientEvidence:
    boolean;
}

export interface GroundedLegalCitation {
  readonly evidenceOrdinal: number;

  readonly sourceKind:
    RetrievalSourceKind;

  readonly sourceId: string;
  readonly versionId: string;

  readonly passageId:
    string | null;

  readonly locator:
    string | null;
}

export interface GroundedLegalProposition {
  readonly text: string;

  readonly citations:
    readonly GroundedLegalCitation[];
}

export interface GroundedLegalSynthesis {
  readonly question: string;

  readonly summary: string;

  readonly propositions:
    readonly GroundedLegalProposition[];

  readonly citations:
    readonly GroundedLegalCitation[];

  readonly unresolvedIssues:
    readonly string[];

  readonly insufficientEvidence:
    boolean;
}
