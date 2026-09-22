import type {
  LegalSynthesisProviderRequest,
  LegalSynthesisProviderResult,
} from '../domain/synthesis.js';

import type { LegalSynthesisProvider } from '../ports/legal-synthesis-provider.js';

import {
  validateLegalSynthesisProviderMetadata,
  type LegalSynthesisProviderMetadata,
} from '../ports/legal-synthesis-provider-metadata.js';

import type {
  LegalSynthesisObservation,
  LegalSynthesisObserver,
} from '../ports/legal-synthesis-observer.js';

export interface ObservedLegalSynthesisProviderDependencies {
  readonly provider: LegalSynthesisProvider;

  readonly metadata: LegalSynthesisProviderMetadata;

  readonly observer: LegalSynthesisObserver;

  /**
   * Injectable monotonic-ish clock for deterministic tests.
   *
   * Production callers may omit it.
   */
  readonly now?: () => number;
}

function safeCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

async function safelyObserve(
  observer: LegalSynthesisObserver,
  event: LegalSynthesisObservation,
): Promise<void> {
  try {
    await observer.observe(Object.freeze(event));
  } catch {
    /**
     * Telemetry must never:
     *
     * - cause legal synthesis to fail;
     * - replace the provider result;
     * - expose provider errors;
     * - change authorization behavior.
     */
  }
}

/**
 * Wrap a LegalSynthesisProvider with safe, content-free operational
 * observability.
 *
 * This adapter does not know or change:
 *
 * - tenant;
 * - user;
 * - task;
 * - jurisdiction authorization;
 * - matter authorization;
 * - retrieval scope;
 * - source authorization;
 * - citations.
 *
 * It observes only the already-bounded provider call.
 */
export function createObservedLegalSynthesisProvider(
  dependencies: ObservedLegalSynthesisProviderDependencies,
): LegalSynthesisProvider {
  const metadata = validateLegalSynthesisProviderMetadata(dependencies.metadata);

  const now = dependencies.now ?? (() => performance.now());

  return Object.freeze({
    async synthesize(
      request: LegalSynthesisProviderRequest,
    ): Promise<LegalSynthesisProviderResult> {
      const startedAt = now();

      try {
        const result = await dependencies.provider.synthesize(request);

        const completedAt = now();

        await safelyObserve(dependencies.observer, {
          operation: 'legal_synthesis.provider',

          providerId: metadata.providerId,

          modelId: metadata.modelId,

          outcome: 'success',

          durationMs: Math.max(0, completedAt - startedAt),

          evidenceCount: request.evidence.length,

          propositionCount: safeCount(result?.propositions),

          unresolvedIssueCount: safeCount(result?.unresolvedIssues),

          insufficientEvidence:
            typeof result?.insufficientEvidence === 'boolean' ? result.insufficientEvidence : null,

          failureCode: null,
        });

        return result;
      } catch (error) {
        const completedAt = now();

        await safelyObserve(dependencies.observer, {
          operation: 'legal_synthesis.provider',

          providerId: metadata.providerId,

          modelId: metadata.modelId,

          outcome: 'failure',

          durationMs: Math.max(0, completedAt - startedAt),

          evidenceCount: request.evidence.length,

          propositionCount: null,

          unresolvedIssueCount: null,

          insufficientEvidence: null,

          failureCode: 'provider_failed',
        });

        /**
         * Preserve the provider exception internally.
         *
         * The application synthesis boundary added in Phase 9J owns public
         * sanitization and converts this to legal_synthesis.provider_failed.
         */
        throw error;
      }
    },
  });
}
