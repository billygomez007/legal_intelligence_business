import { defineIdKind, type Id } from '@legalintel/kernel';

import type { JurisdictionId } from '@legalintel/legal-corpus';

export type JurisdictionEntitlementId = Id<'JurisdictionEntitlement'>;

export const JurisdictionEntitlementId = defineIdKind('JurisdictionEntitlement');

export type JurisdictionEntitlementStatus = 'active' | 'revoked';

export interface JurisdictionEntitlement {
  readonly id: JurisdictionEntitlementId;
  readonly organizationId: string;
  readonly jurisdictionId: JurisdictionId;
  readonly status: JurisdictionEntitlementStatus;
  readonly grantedAt: Date;
  readonly grantedBy: string | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
}

export class JurisdictionNotEntitledError extends Error {
  readonly code = 'JURISDICTION_NOT_ENTITLED';

  constructor(readonly jurisdictionId: JurisdictionId) {
    super('The organization is not actively entitled to the requested jurisdiction.');
    this.name = 'JurisdictionNotEntitledError';
  }
}
