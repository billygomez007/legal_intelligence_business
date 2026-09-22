/**
 * Safe, allowlisted provider telemetry.
 *
 * SECURITY RULE:
 *
 * This event deliberately contains no:
 *
 * - organization ID;
 * - user ID;
 * - task ID;
 * - matter ID;
 * - research question;
 * - retrieval query;
 * - source ID;
 * - version ID;
 * - passage ID;
 * - locator;
 * - evidence excerpt;
 * - prompt;
 * - completion;
 * - API key/token;
 * - provider request/response body;
 * - raw provider error message or stack.
 */
export interface LegalSynthesisObservation {
  readonly operation: 'legal_synthesis.provider';

  readonly providerId: string;

  readonly modelId: string | null;

  readonly outcome: 'success' | 'failure';

  readonly durationMs: number;

  readonly evidenceCount: number;

  readonly propositionCount: number | null;

  readonly unresolvedIssueCount: number | null;

  readonly insufficientEvidence: boolean | null;

  /**
   * Stable application-owned failure classification only.
   *
   * Never place raw provider errors here.
   */
  readonly failureCode: 'provider_failed' | null;
}

export interface LegalSynthesisObserver {
  observe(event: LegalSynthesisObservation): void | Promise<void>;
}

export const noopLegalSynthesisObserver: LegalSynthesisObserver = Object.freeze({
  observe() {
    // Deliberately empty.
  },
});
