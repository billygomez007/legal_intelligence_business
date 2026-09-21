import type { JurisdictionId } from '@legalintel/legal-corpus';

import type { JurisdictionEntitlement } from '../domain/entitlement.js';

export interface EntitlementStore<TTransaction> {
  listOrganizationJurisdictions(tx: TTransaction): Promise<readonly JurisdictionEntitlement[]>;

  findActiveOrganizationJurisdiction(
    tx: TTransaction,
    jurisdictionId: JurisdictionId,
  ): Promise<JurisdictionEntitlement | null>;
  /** Resolves a supported jurisdiction code through the canonical corpus registry. */
  findJurisdictionIdByCode(tx: TTransaction, code: string): Promise<JurisdictionId | null>;
}
