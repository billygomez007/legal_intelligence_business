import type { LegalSynthesisProviderResult } from './synthesis.js';

function fail(): never {
  throw new Error('legal_synthesis.provider_result_invalid');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Providers are external trust boundaries even when the TypeScript
 * interface says they return LegalSynthesisProviderResult.
 *
 * A runtime provider, SDK, mock, transport adapter, network decoder or
 * future implementation can still return malformed JavaScript values.
 *
 * Validate the runtime shape before any application code calls methods
 * such as .trim(), reads proposition fields or iterates arrays.
 */
export function assertLegalSynthesisProviderRuntimeShape(
  value: unknown,
): asserts value is LegalSynthesisProviderResult {
  if (!isRecord(value)) {
    fail();
  }

  if (typeof value['summary'] !== 'string') {
    fail();
  }

  if (typeof value['insufficientEvidence'] !== 'boolean') {
    fail();
  }

  const propositions = value['propositions'];

  if (!Array.isArray(propositions)) {
    fail();
  }

  for (const proposition of propositions) {
    if (!isRecord(proposition)) {
      fail();
    }

    if (typeof proposition['text'] !== 'string') {
      fail();
    }

    const ordinals = proposition['evidenceOrdinals'];

    if (!Array.isArray(ordinals)) {
      fail();
    }

    for (const ordinal of ordinals) {
      if (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal)) {
        fail();
      }
    }
  }

  const unresolvedIssues = value['unresolvedIssues'];

  if (!Array.isArray(unresolvedIssues)) {
    fail();
  }

  for (const issue of unresolvedIssues) {
    if (typeof issue !== 'string') {
      fail();
    }
  }
}
