import { defineIdKind, type Id } from '@legalintel/kernel';

import type { KnowledgeSourceId } from './source.js';

export type KnowledgeSourceVersionId = Id<'KnowledgeSourceVersion'>;
export const KnowledgeSourceVersionId = defineIdKind('KnowledgeSourceVersion');

export interface KnowledgeSourceVersion {
  readonly id: KnowledgeSourceVersionId;
  readonly organizationId: string;
  readonly sourceId: KnowledgeSourceId;
  readonly versionNumber: number;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}
