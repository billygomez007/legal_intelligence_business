import type {
  LegalSynthesisProviderRequest,
  LegalSynthesisProviderResult,
} from '../domain/synthesis.js';

/**
 * Provider-neutral legal synthesis boundary.
 *
 * Implementations may use a configured model provider in a later phase.
 *
 * A provider:
 *
 * - must not retrieve additional legal sources;
 * - must not broaden tenant/task/matter scope;
 * - must not invent authority identifiers;
 * - receives only evidence Law Afrique already authorized;
 * - may cite evidence only by ordinal.
 */
export interface LegalSynthesisProvider {
  synthesize(
    request:
      LegalSynthesisProviderRequest,
  ): Promise<LegalSynthesisProviderResult>;
}
