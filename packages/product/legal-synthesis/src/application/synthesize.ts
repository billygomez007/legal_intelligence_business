import type { GroundedResearchPacket } from '@legalintel/legal-retrieval';

import type {
  GroundedLegalCitation,
  GroundedLegalProposition,
  GroundedLegalSynthesis,
  LegalSynthesisProviderProposition,
  LegalSynthesisProviderRequest,
  LegalSynthesisProviderResult,
  SynthesisEvidenceReference,
} from '../domain/synthesis.js';

import type { LegalSynthesisProvider } from '../ports/legal-synthesis-provider.js';
import { assertLegalSynthesisProviderRuntimeShape } from '../domain/provider-runtime-shape.js';

const MAX_EVIDENCE = 50;
const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_SUMMARY_BYTES = 64 * 1024;
const MAX_PROPOSITIONS = 64;
const MAX_PROPOSITION_BYTES = 16 * 1024;
const MAX_UNRESOLVED = 64;
const MAX_UNRESOLVED_BYTES = 4096;

function fail(code: string): never {
  throw new Error(`legal_synthesis.${code}`);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function cleanText(value: string, code: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    fail(code);
  }

  const normalized = value.trim();

  if (normalized.length === 0 || utf8Bytes(normalized) > maxBytes) {
    fail(code);
  }

  return normalized;
}

function cleanUnresolved(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_UNRESOLVED) {
    fail('unresolved_issues_invalid');
  }

  return Object.freeze(
    values.map((value) => cleanText(value, 'unresolved_issue_invalid', MAX_UNRESOLVED_BYTES)),
  );
}

function prepareEvidence(packet: GroundedResearchPacket): readonly SynthesisEvidenceReference[] {
  if (packet.evidence.length > MAX_EVIDENCE) {
    fail('evidence_limit_exceeded');
  }

  let contextBytes = 0;

  const evidence = packet.evidence.map((item, ordinal): SynthesisEvidenceReference => {
    const excerpt = item.excerpt;

    if (excerpt !== null && typeof excerpt !== 'string') {
      fail('excerpt_invalid');
    }

    if (excerpt !== null && excerpt.includes('\0')) {
      fail('excerpt_invalid');
    }

    if (excerpt !== null) {
      contextBytes += utf8Bytes(excerpt);
    }

    return Object.freeze({
      ordinal,

      source: Object.freeze({
        kind: item.source.kind,
        sourceId: item.source.sourceId,
        versionId: item.source.versionId,
      }),

      passageId: item.passage?.passageId ?? null,

      locator: item.passage?.locator ?? null,

      excerpt,
    });
  });

  if (contextBytes > MAX_CONTEXT_BYTES) {
    fail('context_too_large');
  }

  return Object.freeze(evidence);
}

function citationFor(evidence: SynthesisEvidenceReference): GroundedLegalCitation {
  return Object.freeze({
    evidenceOrdinal: evidence.ordinal,

    sourceKind: evidence.source.kind,

    sourceId: evidence.source.sourceId,

    versionId: evidence.source.versionId,

    passageId: evidence.passageId,

    locator: evidence.locator,
  });
}

function validateProposition(
  input: LegalSynthesisProviderProposition,
  evidence: readonly SynthesisEvidenceReference[],
): GroundedLegalProposition {
  const text = cleanText(input.text, 'proposition_invalid', MAX_PROPOSITION_BYTES);

  if (!Array.isArray(input.evidenceOrdinals) || input.evidenceOrdinals.length === 0) {
    fail('ungrounded_proposition');
  }

  const seen = new Set<number>();

  const citations: GroundedLegalCitation[] = [];

  for (const ordinal of input.evidenceOrdinals) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= evidence.length) {
      fail('ungrounded_citation');
    }

    if (seen.has(ordinal)) {
      continue;
    }

    seen.add(ordinal);

    const source = evidence[ordinal];

    if (source === undefined) {
      fail('ungrounded_citation');
    }

    citations.push(citationFor(source));
  }

  if (citations.length === 0) {
    fail('ungrounded_proposition');
  }

  return Object.freeze({
    text,

    citations: Object.freeze(citations),
  });
}

function validateProviderResult(
  result: LegalSynthesisProviderResult,
  evidence: readonly SynthesisEvidenceReference[],
): {
  readonly summary: string;
  readonly propositions: readonly GroundedLegalProposition[];
  readonly unresolvedIssues: readonly string[];
  readonly insufficientEvidence: boolean;
} {
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof result.insufficientEvidence !== 'boolean'
  ) {
    fail('provider_result_invalid');
  }

  const summary = result.insufficientEvidence
    ? result.summary.trim() === ''
      ? ''
      : cleanText(result.summary, 'summary_invalid', MAX_SUMMARY_BYTES)
    : cleanText(result.summary, 'summary_invalid', MAX_SUMMARY_BYTES);

  if (!Array.isArray(result.propositions) || result.propositions.length > MAX_PROPOSITIONS) {
    fail('propositions_invalid');
  }

  if (!result.insufficientEvidence && result.propositions.length === 0) {
    fail('propositions_required');
  }

  const propositions = Object.freeze(
    result.propositions.map((proposition) => validateProposition(proposition, evidence)),
  );

  return Object.freeze({
    summary,

    propositions,

    unresolvedIssues: cleanUnresolved(result.unresolvedIssues),

    insufficientEvidence: result.insufficientEvidence,
  });
}

function uniqueCitations(
  propositions: readonly GroundedLegalProposition[],
): readonly GroundedLegalCitation[] {
  const result: GroundedLegalCitation[] = [];

  const seen = new Set<number>();

  for (const proposition of propositions) {
    for (const citation of proposition.citations) {
      if (seen.has(citation.evidenceOrdinal)) {
        continue;
      }

      seen.add(citation.evidenceOrdinal);

      result.push(citation);
    }
  }

  return Object.freeze(result);
}

/**
 * Convert an already-grounded Phase 8 research packet into a provider-generated
 * legal synthesis while preserving application-owned citation identity.
 *
 * This function performs no retrieval and no source authorization itself.
 * Callers must obtain the GroundedResearchPacket from the authorized Phase 8
 * retrieval pipeline.
 */
export async function synthesizeGroundedLegalResearch(
  provider: LegalSynthesisProvider,
  packet: GroundedResearchPacket,
): Promise<GroundedLegalSynthesis> {
  if (packet.scope.countryCode !== 'GH') {
    fail('jurisdiction_not_supported');
  }

  const question = cleanText(packet.question, 'question_invalid', 8192);

  const packetIssues = cleanUnresolved(packet.unresolvedIssues);

  const evidence = prepareEvidence(packet);

  /**
   * No evidence means no model call.
   *
   * This prevents a provider from answering a legal question from general
   * model memory when Law Afrique has no authorized supporting authority.
   */
  if (packet.insufficientEvidence || evidence.length === 0) {
    return Object.freeze({
      question,

      summary: '',

      propositions: Object.freeze([]),

      citations: Object.freeze([]),

      unresolvedIssues: packetIssues,

      insufficientEvidence: true,
    });
  }

  const request: LegalSynthesisProviderRequest = Object.freeze({
    question,

    countryCode: 'GH',

    evidence,

    unresolvedIssues: packetIssues,
  });

  let rawProviderResult: LegalSynthesisProviderResult;

  try {
    rawProviderResult = await provider.synthesize(request);
  } catch {
    /**
     * Provider exceptions cross an external trust boundary.
     *
     * Never expose provider error text, stack traces, credentials,
     * request IDs, prompts, evidence excerpts or completion fragments.
     */
    fail('provider_failed');
  }

  assertLegalSynthesisProviderRuntimeShape(rawProviderResult);

  const providerResult = validateProviderResult(rawProviderResult, evidence);

  const unresolvedIssues = Object.freeze(
    [...packetIssues, ...providerResult.unresolvedIssues].slice(0, MAX_UNRESOLVED),
  );

  return Object.freeze({
    question,

    summary: providerResult.summary,

    propositions: providerResult.propositions,

    citations: uniqueCitations(providerResult.propositions),

    unresolvedIssues,

    insufficientEvidence: providerResult.insufficientEvidence,
  });
}
