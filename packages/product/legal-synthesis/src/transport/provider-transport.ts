import type {
  LegalSynthesisProviderRequest,
  LegalSynthesisProviderResult,
} from '../domain/synthesis.js';

const MAX_TRANSPORT_BYTES = 384 * 1024;

const MAX_RESPONSE_BYTES = 128 * 1024;

const MAX_PROPOSITIONS = 64;

const MAX_EVIDENCE_ORDINALS = 50;

const MAX_UNRESOLVED = 64;

function fail(code: string): never {
  throw new Error(`legal_synthesis.transport_${code}`);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      fail('unknown_field');
    }
  }
}

/**
 * Vendor-neutral request envelope.
 *
 * This contains only the already-authorized and already-bounded provider
 * request created by the Law Afrique application layer.
 *
 * It deliberately contains no:
 *
 * - organization ID;
 * - task ID;
 * - matter ID;
 * - user ID;
 * - API key;
 * - provider credential;
 * - database connection information.
 */
export interface LegalSynthesisTransportRequest {
  readonly schemaVersion: 1;

  readonly task: 'grounded_legal_synthesis';

  readonly jurisdiction: 'GH';

  readonly question: string;

  readonly evidence: readonly {
    readonly ordinal: number;

    readonly sourceKind: string;

    readonly sourceId: string;

    readonly versionId: string;

    readonly passageId: string | null;

    readonly locator: string | null;

    readonly excerpt: string | null;
  }[];

  readonly unresolvedIssues: readonly string[];
}

export function buildLegalSynthesisTransportRequest(
  request: LegalSynthesisProviderRequest,
): LegalSynthesisTransportRequest {
  const transport = Object.freeze({
    schemaVersion: 1 as const,

    task: 'grounded_legal_synthesis' as const,

    jurisdiction: request.countryCode,

    question: request.question,

    evidence: Object.freeze(
      request.evidence.map((item) =>
        Object.freeze({
          ordinal: item.ordinal,

          sourceKind: item.source.kind,

          sourceId: item.source.sourceId,

          versionId: item.source.versionId,

          passageId: item.passageId,

          locator: item.locator,

          excerpt: item.excerpt,
        }),
      ),
    ),

    unresolvedIssues: Object.freeze([...request.unresolvedIssues]),
  });

  const serialized = JSON.stringify(transport);

  if (utf8Bytes(serialized) > MAX_TRANSPORT_BYTES) {
    fail('request_too_large');
  }

  return transport;
}

export function serializeLegalSynthesisTransportRequest(
  request: LegalSynthesisProviderRequest,
): string {
  return JSON.stringify(buildLegalSynthesisTransportRequest(request));
}

function parseString(value: unknown, allowEmpty: boolean): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    fail('response_invalid');
  }

  return value;
}

function parseStringArray(value: unknown, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max) {
    fail('response_invalid');
  }

  return Object.freeze(value.map((item) => parseString(item, false)));
}

function parseOrdinals(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_ORDINALS) {
    fail('response_invalid');
  }

  return Object.freeze(
    value.map((ordinal) => {
      if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
        fail('response_invalid');
      }

      return ordinal;
    }),
  );
}

export function parseLegalSynthesisTransportResponse(body: string): LegalSynthesisProviderResult {
  if (typeof body !== 'string' || utf8Bytes(body) > MAX_RESPONSE_BYTES) {
    fail('response_too_large');
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(body);
  } catch {
    fail('response_json_invalid');
  }

  if (!isRecord(decoded)) {
    fail('response_invalid');
  }

  rejectUnknownKeys(decoded, [
    'schemaVersion',
    'summary',
    'propositions',
    'unresolvedIssues',
    'insufficientEvidence',
  ]);

  if (
    decoded['schemaVersion'] !== 1 ||
    typeof decoded['insufficientEvidence'] !== 'boolean' ||
    !Array.isArray(decoded['propositions']) ||
    decoded['propositions'].length > MAX_PROPOSITIONS
  ) {
    fail('response_invalid');
  }

  const propositions = Object.freeze(
    decoded['propositions'].map((value) => {
      if (!isRecord(value)) {
        fail('response_invalid');
      }

      rejectUnknownKeys(value, ['text', 'evidenceOrdinals']);

      return Object.freeze({
        text: parseString(value['text'], false),

        evidenceOrdinals: parseOrdinals(value['evidenceOrdinals']),
      });
    }),
  );

  return Object.freeze({
    summary: parseString(decoded['summary'], decoded['insufficientEvidence']),

    propositions,

    unresolvedIssues: parseStringArray(decoded['unresolvedIssues'], MAX_UNRESOLVED),

    insufficientEvidence: decoded['insufficientEvidence'],
  });
}

export const legalSynthesisTransportLimits = Object.freeze({
  requestBytes: MAX_TRANSPORT_BYTES,

  responseBytes: MAX_RESPONSE_BYTES,

  propositions: MAX_PROPOSITIONS,

  evidenceOrdinals: MAX_EVIDENCE_ORDINALS,

  unresolvedIssues: MAX_UNRESOLVED,
});
