import { describe, expect, it } from 'vitest';

import { JurisdictionNotEntitledError, JurisdictionEntitlementId } from '../src/domain/entitlement';

describe('jurisdiction entitlement domain', () => {
  it('parses entitlement identifiers through the shared opaque ID convention', () => {
    const id = crypto.randomUUID();

    expect(JurisdictionEntitlementId.parse(id)).toBe(id);
  });

  it('uses a stable error code for missing active jurisdiction entitlement', () => {
    const jurisdictionId = crypto.randomUUID() as never;
    const error = new JurisdictionNotEntitledError(jurisdictionId);

    expect(error.code).toBe('JURISDICTION_NOT_ENTITLED');
    expect(error.jurisdictionId).toBe(jurisdictionId);
  });
});
