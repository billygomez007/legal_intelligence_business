import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JURISDICTION,
  UnsupportedJurisdictionError,
  isSupportedJurisdiction,
  jurisdictionCodes,
  jurisdictions,
  requireSupportedJurisdiction,
  resolveJurisdiction,
} from '../src/domain/jurisdiction';

describe('Ghana-first jurisdiction domain', () => {
  it('supports Ghana only', () => {
    expect(jurisdictionCodes).toEqual(['GH']);

    expect(jurisdictions).toEqual([
      {
        code: 'GH',
        name: 'Ghana',
        active: true,
      },
    ]);

    expect(DEFAULT_JURISDICTION).toBe('GH');
  });

  it('accepts GH', () => {
    expect(isSupportedJurisdiction('GH')).toBe(true);

    expect(requireSupportedJurisdiction('GH')).toBe('GH');
  });

  it('rejects unsupported jurisdictions', () => {
    expect(isSupportedJurisdiction('NG')).toBe(false);
    expect(isSupportedJurisdiction('KE')).toBe(false);
    expect(isSupportedJurisdiction('ZA')).toBe(false);

    expect(() => requireSupportedJurisdiction('NG')).toThrow(UnsupportedJurisdictionError);
  });

  it('defaults an unspecified jurisdiction to Ghana', () => {
    expect(resolveJurisdiction()).toBe('GH');
    expect(resolveJurisdiction(null)).toBe('GH');
    expect(resolveJurisdiction('')).toBe('GH');
  });

  it('never silently converts another country to Ghana', () => {
    expect(() => resolveJurisdiction('NG')).toThrow(UnsupportedJurisdictionError);

    expect(() => resolveJurisdiction('KE')).toThrow(UnsupportedJurisdictionError);
  });
});
