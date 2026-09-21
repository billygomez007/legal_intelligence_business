export const jurisdictionCodes = ['GH'] as const;

export type JurisdictionCode = (typeof jurisdictionCodes)[number];

export interface JurisdictionDefinition {
  readonly code: JurisdictionCode;
  readonly name: string;
  readonly active: boolean;
}

export const jurisdictions: readonly JurisdictionDefinition[] = [
  {
    code: 'GH',
    name: 'Ghana',
    active: true,
  },
];

export const DEFAULT_JURISDICTION: JurisdictionCode = 'GH';

export class UnsupportedJurisdictionError extends Error {
  readonly code = 'UNSUPPORTED_JURISDICTION';

  constructor(readonly jurisdiction: string) {
    super(`Unsupported jurisdiction: ${jurisdiction}`);
    this.name = 'UnsupportedJurisdictionError';
  }
}

export function isSupportedJurisdiction(value: string): value is JurisdictionCode {
  return jurisdictions.some((jurisdiction) => jurisdiction.active && jurisdiction.code === value);
}

export function requireSupportedJurisdiction(value: string): JurisdictionCode {
  if (!isSupportedJurisdiction(value)) {
    throw new UnsupportedJurisdictionError(value);
  }

  return value;
}

export function resolveJurisdiction(requested?: string | null): JurisdictionCode {
  if (requested === undefined || requested === null || requested === '') {
    return DEFAULT_JURISDICTION;
  }

  return requireSupportedJurisdiction(requested);
}
