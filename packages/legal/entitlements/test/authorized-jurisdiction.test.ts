import { JurisdictionId } from '@legalintel/legal-corpus';
import { describe, expect, it, vi } from 'vitest';

import {
  JurisdictionEntitlementId,
  JurisdictionNotConfiguredError,
  JurisdictionNotEntitledError,
  UnsupportedJurisdictionError,
  resolveAuthorizedJurisdiction,
  type EntitlementStore,
  type JurisdictionEntitlement,
} from '../src';

interface Tx {
  readonly marker: 'tx';
}

const tx: Tx = { marker: 'tx' };

const jurisdictionId = JurisdictionId.parse('11111111-1111-4111-8111-111111111111');

const active: JurisdictionEntitlement = {
  id: JurisdictionEntitlementId.parse('22222222-2222-4222-8222-222222222222'),
  organizationId: '33333333-3333-4333-8333-333333333333',
  jurisdictionId,
  status: 'active',
  grantedAt: new Date('2026-01-01T00:00:00.000Z'),
  grantedBy: null,
  revokedAt: null,
  revokedBy: null,
};

function buildStore(configured: JurisdictionId | null = jurisdictionId, entitled = true) {
  const findJurisdictionIdByCode = vi.fn((_tx: Tx, code: string): Promise<JurisdictionId | null> =>
    Promise.resolve(code === 'GH' ? configured : null),
  );

  const listOrganizationJurisdictions = vi.fn(
    (_tx: Tx): Promise<readonly JurisdictionEntitlement[]> => Promise.resolve([]),
  );

  const findActiveOrganizationJurisdiction = vi.fn(
    (_tx: Tx, _jurisdictionId: JurisdictionId): Promise<JurisdictionEntitlement | null> =>
      Promise.resolve(entitled ? active : null),
  );

  const subject: EntitlementStore<Tx> = {
    findJurisdictionIdByCode,
    listOrganizationJurisdictions,
    findActiveOrganizationJurisdiction,
  };

  return {
    subject,
    findJurisdictionIdByCode,
    findActiveOrganizationJurisdiction,
  };
}

describe('authorized jurisdiction resolution', () => {
  it('defaults an omitted jurisdiction to Ghana and returns its canonical id', async () => {
    const { subject, findJurisdictionIdByCode, findActiveOrganizationJurisdiction } = buildStore();

    await expect(resolveAuthorizedJurisdiction(subject, tx)).resolves.toBe(jurisdictionId);

    expect(findJurisdictionIdByCode).toHaveBeenCalledWith(tx, 'GH');

    expect(findActiveOrganizationJurisdiction).toHaveBeenCalledWith(tx, jurisdictionId);
  });

  it('accepts explicit GH', async () => {
    const { subject } = buildStore();

    await expect(resolveAuthorizedJurisdiction(subject, tx, 'GH')).resolves.toBe(jurisdictionId);
  });

  it('rejects an explicitly unsupported jurisdiction before corpus lookup', async () => {
    const { subject, findJurisdictionIdByCode, findActiveOrganizationJurisdiction } = buildStore();

    await expect(resolveAuthorizedJurisdiction(subject, tx, 'NG')).rejects.toBeInstanceOf(
      UnsupportedJurisdictionError,
    );

    expect(findJurisdictionIdByCode).not.toHaveBeenCalled();

    expect(findActiveOrganizationJurisdiction).not.toHaveBeenCalled();
  });

  it('fails closed when Ghana is not configured in the canonical corpus registry', async () => {
    const { subject, findActiveOrganizationJurisdiction } = buildStore(null);

    await expect(resolveAuthorizedJurisdiction(subject, tx, 'GH')).rejects.toBeInstanceOf(
      JurisdictionNotConfiguredError,
    );

    expect(findActiveOrganizationJurisdiction).not.toHaveBeenCalled();
  });

  it('rejects Ghana when the current tenant has no active entitlement', async () => {
    const { subject } = buildStore(jurisdictionId, false);

    await expect(resolveAuthorizedJurisdiction(subject, tx, 'GH')).rejects.toBeInstanceOf(
      JurisdictionNotEntitledError,
    );
  });
});
