import { defineIdKind, type Id } from '@legalintel/kernel';

export type JurisdictionId = Id<'Jurisdiction'>;
export const JurisdictionId = defineIdKind('Jurisdiction');

export type CourtId = Id<'Court'>;
export const CourtId = defineIdKind('Court');

export type SourceId = Id<'Source'>;
export const SourceId = defineIdKind('Source');

/** A legal work: the stable identity of a case, statute or rule across all its versions. */
export type DocumentId = Id<'Document'>;
export const DocumentId = defineIdKind('Document');

/** One immutable acquisition of a work. Passages and citations attach to a version. */
export type VersionId = Id<'DocumentVersion'>;
export const VersionId = defineIdKind('DocumentVersion');

export type PassageId = Id<'Passage'>;
export const PassageId = defineIdKind('Passage');

export type CitationId = Id<'Citation'>;
export const CitationId = defineIdKind('Citation');
