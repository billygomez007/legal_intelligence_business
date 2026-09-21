import { defineIdKind, type Id } from '@legalintel/kernel';

import type { MatterDocumentId } from './document';

export type MatterDocumentVersionId = Id<'MatterDocumentVersion'>;
export const MatterDocumentVersionId = defineIdKind('MatterDocumentVersion');

export interface MatterDocumentVersion {
  readonly id: MatterDocumentVersionId;
  readonly organizationId: string;
  readonly matterId: string;
  readonly documentId: MatterDocumentId;
  readonly versionNumber: number;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}
