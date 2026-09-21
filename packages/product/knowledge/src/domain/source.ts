import { defineIdKind, type Id } from '@legalintel/kernel';

export type KnowledgeSourceId = Id<'KnowledgeSource'>;
export const KnowledgeSourceId = defineIdKind('KnowledgeSource');

export const knowledgeSourceStatuses = ['active', 'archived'] as const;
export type KnowledgeSourceStatus = (typeof knowledgeSourceStatuses)[number];

export interface KnowledgeSource {
  readonly id: KnowledgeSourceId;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: KnowledgeSourceStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
