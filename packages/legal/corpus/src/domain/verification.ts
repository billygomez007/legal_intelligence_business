import { createHash } from 'node:crypto';

import type { DocumentType } from './authority';

/**
 * Publish-critical metadata and how a person verifies it.
 *
 * Machine extraction proposes values and never verifies them. Before a version can be approved,
 * a person must verify each field that matters for its kind of document, and the verification is
 * bound to the exact value they saw. `CRITICAL_FIELDS` mirrors the database table
 * `corpus.critical_metadata_fields`, and `fieldFingerprint` mirrors `corpus.field_fingerprint`;
 * parity tests run both so the copies cannot drift apart.
 */
export const METADATA_FIELDS = [
  'title',
  'jurisdiction',
  'court',
  'decision_date',
  'neutral_citation',
  'docket_number',
  'instrument_number',
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

/** `verified`: the value is correct. `rejected`: it is wrong and must be corrected and verified again. */
export const VERIFICATION_STATUSES = ['verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * `required`: needs a value and a current verification.
 * `if_present`: needs a verification only when the corpus records a value ("where applicable").
 */
export type FieldRequirement = 'required' | 'if_present';

export interface CriticalField {
  readonly field: MetadataField;
  readonly requirement: FieldRequirement;
}

const EVERY_DOCUMENT: readonly CriticalField[] = [
  { field: 'title', requirement: 'required' },
  { field: 'jurisdiction', requirement: 'required' },
];

/**
 * Cases and legislation have different critical fields, and nothing here is required of a kind
 * of document that has no such thing (legislation has no court).
 */
export const CRITICAL_FIELDS: Readonly<Record<DocumentType, readonly CriticalField[]>> = {
  case: [
    ...EVERY_DOCUMENT,
    { field: 'court', requirement: 'required' },
    { field: 'decision_date', requirement: 'required' },
    { field: 'neutral_citation', requirement: 'if_present' },
    { field: 'docket_number', requirement: 'if_present' },
  ],
  legislation: [...EVERY_DOCUMENT, { field: 'instrument_number', requirement: 'if_present' }],
  regulation: EVERY_DOCUMENT,
  court_rule: EVERY_DOCUMENT,
  practice_direction: EVERY_DOCUMENT,
  treaty: EVERY_DOCUMENT,
  gazette_notice: EVERY_DOCUMENT,
  commentary: EVERY_DOCUMENT,
};

/**
 * What a verification is bound to: SHA-256 over the field name, a newline and the value. The
 * field name is part of what is hashed, so a fingerprint made for one field cannot be presented
 * for another. Must equal `corpus.field_fingerprint`.
 */
export function fieldFingerprint(field: MetadataField, value: string): Buffer {
  return createHash('sha256').update(`${field}\n${value}`, 'utf8').digest();
}

/** One critical field of a version, as the review packet and the approval gate see it. */
export interface CriticalMetadataRow {
  readonly field: MetadataField;
  readonly requirement: FieldRequirement;
  /** What the corpus currently holds. `null`: nothing is recorded. */
  readonly value: string | null;
  /** Fingerprint of `value`; what a verification must quote to be accepted. */
  readonly valueSha256: Buffer | null;
  readonly latestStatus: VerificationStatus | null;
  readonly latestBy: string | null;
  readonly latestAt: Date | null;
  /** The latest verification says `verified` AND still matches the current value. */
  readonly isCurrent: boolean;
  /** This field alone stops the version being approved. */
  readonly blocking: boolean;
}

export interface NewFieldVerification {
  readonly versionId: string;
  readonly field: MetadataField;
  readonly status: VerificationStatus;
  /** Fingerprint of the value the person saw (`CriticalMetadataRow.valueSha256`). */
  readonly valueSha256: Buffer;
  /** Where they confirmed it: a page, a registry entry, a gazette reference. */
  readonly evidenceReference: string;
  /** The reviewing person. The database cannot know who the human is; the caller supplies it. */
  readonly verifiedBy: string;
}

/**
 * A record that a version's provenance passed a named hand-off protocol. The corpus requires one
 * before approval and publication; ingestion writes it, through a checked database function,
 * only after its own evidence checks have passed. Append-only.
 */
export interface ProvenanceAttestation {
  readonly id: string;
  readonly attestationType: string;
  readonly attestationVersion: number;
  readonly pipelineVersion: string;
  /** An opaque pointer to the attester's own evidence. */
  readonly evidenceReference: string;
  readonly systemIdentity: string;
  /** The person on whose request the version was acquired, when there was one. */
  readonly actorId: string | null;
  readonly attestedAt: Date;
}
