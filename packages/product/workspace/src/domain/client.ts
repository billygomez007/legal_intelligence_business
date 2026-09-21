import { defineIdKind, type Id } from '@legalintel/kernel';

export type ClientId = Id<'Client'>;

export const ClientId = defineIdKind('Client');

export type ClientStatus = 'active' | 'archived';

export interface Client {
  readonly id: ClientId;
  readonly organizationId: string;
  readonly name: string;
  readonly reference: string | null;
  readonly status: ClientStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
