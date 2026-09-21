import { defineIdKind, type Id } from '@legalintel/kernel';

export type MatterDocumentId = Id<'MatterDocument'>;
export const MatterDocumentId = defineIdKind('MatterDocument');

export const matterDocumentStatuses = ['active', 'archived'] as const;
export type MatterDocumentStatus = (typeof matterDocumentStatuses)[number];

export interface MatterDocument {
  readonly id: MatterDocumentId;
  readonly organizationId: string;
  readonly matterId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: MatterDocumentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
