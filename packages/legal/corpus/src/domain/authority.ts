/**
 * Court hierarchy (docs/19: "the system should understand court hierarchy"). Rank 1 is the
 * highest authority within a jurisdiction. Authority never crosses jurisdictions here:
 * whether a foreign decision is persuasive is a separate, explicitly modelled question.
 */
export interface CourtAuthority {
  readonly jurisdictionId: string;
  /** 1 = highest authority in the jurisdiction. */
  readonly authorityRank: number;
}

/** Does a decision of `deciding` bind `subordinate`? */
export function binds(deciding: CourtAuthority, subordinate: CourtAuthority): boolean {
  return (
    deciding.jurisdictionId === subordinate.jurisdictionId &&
    deciding.authorityRank < subordinate.authorityRank
  );
}

/** Same-jurisdiction decisions of equal rank are persuasive, not binding. */
export function isPersuasive(a: CourtAuthority, b: CourtAuthority): boolean {
  return a.jurisdictionId === b.jurisdictionId && a.authorityRank === b.authorityRank;
}

export const DOCUMENT_TYPES = [
  'case',
  'legislation',
  'regulation',
  'court_rule',
  'practice_direction',
  'treaty',
  'gazette_notice',
  'commentary',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SOURCE_KINDS = [
  'court_registry',
  'government_gazette',
  'legislature',
  'publisher',
  'institutional_repository',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
