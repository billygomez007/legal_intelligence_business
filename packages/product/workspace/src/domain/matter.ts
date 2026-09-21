import { defineIdKind, type Id } from '@legalintel/kernel';
import type { JurisdictionId } from '@legalintel/legal-corpus';

import type { ClientId } from './client.js';

export type MatterId = Id<'Matter'>;

export const MatterId = defineIdKind('Matter');

export type MatterStatus = 'open' | 'closed' | 'archived';

export interface Matter {
  readonly id: MatterId;
  readonly organizationId: string;
  readonly clientId: ClientId;
  readonly jurisdictionId: JurisdictionId;
  readonly name: string;
  readonly reference: string | null;
  readonly status: MatterStatus;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
