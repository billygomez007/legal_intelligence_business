import { z } from 'zod';

export const PIPELINE_VERSION = 'ingestion/1';
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT = 1_000_000;
export const MAX_PASSAGES = 4000;
export const MAX_ATTEMPTS = 3;
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
export function failureCategory(error: unknown): FailureCategory {
  return error instanceof IngestionFailure ? error.category : 'internal_error';
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
