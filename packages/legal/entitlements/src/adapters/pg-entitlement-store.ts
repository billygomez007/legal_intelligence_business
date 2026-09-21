import type { Tx } from '@legalintel/db';
import { JurisdictionId } from '@legalintel/legal-corpus';

import { JurisdictionEntitlementId, type JurisdictionEntitlement } from '../domain/entitlement.js';
import type { EntitlementStore } from '../ports/entitlement-store.js';

interface EntitlementRow {
  readonly id: string;
  readonly organization_id: string;
  readonly jurisdiction_id: string;
  readonly status: 'active' | 'revoked';
  readonly granted_at: Date;
  readonly granted_by: string | null;
  readonly revoked_at: Date | null;
  readonly revoked_by: string | null;
}

const entitlementColumns = `
  id,
  organization_id,
  jurisdiction_id,
  status,
  granted_at,
  granted_by,
  revoked_at,
  revoked_by
`;

function mapEntitlement(row: EntitlementRow): JurisdictionEntitlement {
  return {
    id: JurisdictionEntitlementId.parse(row.id),
    organizationId: row.organization_id,
    jurisdictionId: JurisdictionId.parse(row.jurisdiction_id),
    status: row.status,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

export class PgEntitlementStore implements EntitlementStore<Tx> {
  async findJurisdictionIdByCode(tx: Tx, code: string): Promise<JurisdictionId | null> {
    const result = await tx.query<{ id: string }>(
      `SELECT id
       FROM corpus.jurisdictions
       WHERE code = $1
         AND is_synthetic = false`,
      [code],
    );

    const id = result.rows[0]?.id;
    return id === undefined ? null : JurisdictionId.parse(id);
  }

  async listOrganizationJurisdictions(tx: Tx): Promise<readonly JurisdictionEntitlement[]> {
    const result = await tx.query<EntitlementRow>(
      `SELECT ${entitlementColumns}
       FROM policy.organization_jurisdictions
       WHERE organization_id = app.current_org_id()
       ORDER BY granted_at ASC, id ASC`,
    );

    return result.rows.map(mapEntitlement);
  }

  async findActiveOrganizationJurisdiction(
    tx: Tx,
    jurisdictionId: JurisdictionId,
  ): Promise<JurisdictionEntitlement | null> {
    const result = await tx.query<EntitlementRow>(
      `SELECT ${entitlementColumns}
       FROM policy.organization_jurisdictions
       WHERE organization_id = app.current_org_id()
         AND jurisdiction_id = $1
         AND status = 'active'
       LIMIT 1`,
      [jurisdictionId],
    );

    const row = result.rows[0];

    return row ? mapEntitlement(row) : null;
  }
}

export const entitlementStore = new PgEntitlementStore();
