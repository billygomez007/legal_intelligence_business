import type { JurisdictionId } from '@legalintel/legal-corpus';

import {
  JurisdictionNotEntitledError,
  type JurisdictionEntitlement,
} from '../domain/entitlement.js';
import { resolveJurisdiction } from '../domain/jurisdiction.js';
import type { EntitlementStore } from '../ports/entitlement-store.js';

export async function requireActiveJurisdictionEntitlement<TTransaction>(
  store: EntitlementStore<TTransaction>,
  tx: TTransaction,
  jurisdictionId: JurisdictionId,
): Promise<JurisdictionEntitlement> {
  const entitlement = await store.findActiveOrganizationJurisdiction(tx, jurisdictionId);

  if (!entitlement) {
    throw new JurisdictionNotEntitledError(jurisdictionId);
  }

  return entitlement;
}

export class JurisdictionNotConfiguredError extends Error {
  readonly code = 'jurisdiction.not_configured';

  constructor(readonly jurisdictionCode: string) {
    super('The requested jurisdiction is not configured in the canonical legal corpus.');
    this.name = 'JurisdictionNotConfiguredError';
  }
}

/**
 * Resolves the request's jurisdiction server-side and returns only a canonical jurisdiction
 * for which the current tenant has an active entitlement.
 *
 * An omitted jurisdiction follows the Ghana-first domain default. An explicitly unsupported
 * jurisdiction is rejected by resolveJurisdiction and is never silently converted to Ghana.
 */
export async function resolveAuthorizedJurisdiction<TTransaction>(
  store: EntitlementStore<TTransaction>,
  tx: TTransaction,
  requested?: string | null,
): Promise<JurisdictionId> {
  const code = resolveJurisdiction(requested);
  const jurisdictionId = await store.findJurisdictionIdByCode(tx, code);

  if (jurisdictionId === null) {
    throw new JurisdictionNotConfiguredError(code);
  }

  const entitlement = await requireActiveJurisdictionEntitlement(store, tx, jurisdictionId);

  return entitlement.jurisdictionId;
}
