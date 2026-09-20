import { z } from 'zod';

export const PIPELINE_VERSION = 'ingestion/1';
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT = 1_000_000;
export const MAX_PASSAGES = 4000;
export const MAX_ATTEMPTS = 3;
/**
 * Below this the text is mostly not letters or digits (binary noise, a broken decode, a scan
 * without a text layer). It is a floor for routing to a person, not a claim of accuracy.
 */
export const MIN_EXTRACTION_QUALITY = 0.5;
/** Minimum letters and digits for a document to be worth parsing at all. */
export const MIN_VISIBLE_CHARACTERS = 20;

/** Unicode code points, which is how offsets are counted (PostgreSQL substring semantics). */
export const codePoints = (text: string): string[] => Array.from(text);
export const codePointLength = (text: string): number => codePoints(text).length;
export const safeLabel = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
export const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const mediaSchema = z.enum(['text/plain', 'text/html', 'application/pdf']);
export const requestSchema = z.strictObject({
  sourceId: z.uuid(),
  jurisdictionId: z.uuid(),
  operation: z.literal('structure'),
  inputReference: z.uuid(),
  expectedChecksum: checksumSchema,
  mediaType: mediaSchema,
  parserId: safeLabel,
  documentType: z.enum(['case', 'legislation']),
  idempotencyKey: safeLabel,
  actorId: z.uuid(),
  correlationId: z.uuid(),
});
export type IngestionRequest = z.infer<typeof requestSchema>;
export type MediaType = z.infer<typeof mediaSchema>;
export const STAGES = [
  'requested',
  'acquisition',
  'storage',
  'extraction',
  'parsing',
  'validation',
  'review',
] as const;
export type Stage = (typeof STAGES)[number];
export type JobStatus = 'queued' | 'running' | 'failed' | 'needs_review' | 'pending_review';
export interface Job {
  id: string;
  request: IngestionRequest;
  pipelineVersion: string;
  status: JobStatus;
  stage: Stage;
  attempts: number;
  artifactId: string | null;
  versionId: string | null;
  failureCategory: FailureCategory | null;
}
export const FAILURES = {
  rights_denied: 'terminal',
  acquisition_failed: 'retryable',
  integrity_failed: 'terminal',
  unsupported_format: 'review',
  extraction_failed: 'terminal',
  extraction_quality_low: 'review',
  parse_failed: 'review',
  metadata_invalid: 'review',
  duplicate_detected: 'review',
  validation_failed: 'terminal',
  storage_failed: 'retryable',
  input_invalid: 'terminal',
  internal_error: 'terminal',
} as const;
export type FailureCategory = keyof typeof FAILURES;
export class IngestionFailure extends Error {
  constructor(readonly category: FailureCategory) {
    super(`Ingestion stopped: ${category}.`);
    this.name = 'IngestionFailure';
  }
}
/**
 * Database conditions that name a specific outcome. Matched on the stable hint or code only,
 * never on message text (which can quote values).
 */
const CATEGORY_BY_HINT: Readonly<Record<string, FailureCategory>> = {
  'corpus.rights_denied': 'rights_denied',
  'ingestion.stale_rights_evidence': 'rights_denied',
  'ingestion.unvalidated_handoff': 'validation_failed',
  'ingestion.task_decided': 'input_invalid',
  'ingestion.cannot_approve': 'input_invalid',
  'ingestion.corpus_decision_required': 'validation_failed',
  'corpus.review_not_pending': 'validation_failed',
  'corpus.review_not_ready': 'validation_failed',
  'corpus.review_decision_required': 'validation_failed',
  'corpus.metadata_unverified': 'validation_failed',
  'corpus.provenance_required': 'validation_failed',
  'ingestion.attestation_not_ready': 'validation_failed',
  'ingestion.attestation_missing': 'validation_failed',
};
const CATEGORY_BY_APP_CODE: Readonly<Record<string, FailureCategory>> = {
  'corpus.rights_denied': 'rights_denied',
  'corpus.duplicate_content': 'duplicate_detected',
  'corpus.review_not_pending': 'validation_failed',
  'corpus.review_not_ready': 'validation_failed',
  'corpus.review_decision_required': 'validation_failed',
  'corpus.invalid_transition': 'validation_failed',
  'corpus.metadata_unverified': 'validation_failed',
  'corpus.provenance_required': 'validation_failed',
};
/** PostgreSQL condition classes that a retry can cure: connection, rollback, resources, shutdown. */
const TRANSIENT_SQLSTATE_CLASSES = new Set(['08', '40', '53', '57']);

/**
 * Maps anything thrown while processing to a category. Unknown errors are `internal_error`
 * (terminal, visible), never a guess at something more specific: an unclassified fault must not
 * be retried blindly or reported as something it is not.
 */
export function failureCategory(error: unknown): FailureCategory {
  if (error instanceof IngestionFailure) return error.category;
  if (typeof error !== 'object' || error === null) return 'internal_error';
  const hint = 'hint' in error && typeof error.hint === 'string' ? error.hint : undefined;
  if (hint !== undefined && hint in CATEGORY_BY_HINT)
    return CATEGORY_BY_HINT[hint] ?? 'internal_error';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code === undefined) return 'internal_error';
  if (code in CATEGORY_BY_APP_CODE) return CATEGORY_BY_APP_CODE[code] ?? 'internal_error';
  return TRANSIENT_SQLSTATE_CLASSES.has(code.slice(0, 2)) ? 'storage_failed' : 'internal_error';
}

/** All offsets count Unicode code points, matching PostgreSQL substring indexing. */
export interface Evidence {
  start: number;
  end: number;
  quote: string;
}
export interface DerivedField extends Evidence {
  field: string;
  value: string;
  origin: 'deterministic' | 'parser' | 'machine';
  confidence: number;
  reviewState: 'unreviewed';
}
export interface Segment {
  ordinal: number;
  locator: string;
  text: string;
  start: number;
  end: number;
}
export interface CitationCandidate extends Evidence {
  passageOrdinal: number;
  identifier: string;
  confidence: number;
}
export interface ConceptCandidate extends Evidence {
  conceptReference: string;
  confidence: number;
}
export interface ParsedDocument {
  fields: DerivedField[];
  passages: Segment[];
  citations: CitationCandidate[];
  concepts: ConceptCandidate[];
  warnings: string[];
}
export interface Extraction {
  text: string;
  extractorVersion: string;
  quality: number;
  warnings: string[];
}
/** Milliseconds spent in each stage of one attempt; recorded per stage, never cumulative. */
export interface ArtifactTimings {
  acquisitionMs: number;
  storageMs: number;
}
export interface SubmitTimings {
  parsingMs: number;
  validationMs: number;
}
export interface Artifact {
  id: string;
  sourceId: string;
  jurisdictionId: string;
  checksum: string;
  storageKey: string;
  mediaType: MediaType;
  byteSize: number;
  acquiredAt: Date;
}
