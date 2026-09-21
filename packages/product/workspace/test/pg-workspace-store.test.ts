import { describe, expect, it } from 'vitest';

import { mapWorkspaceError } from '../src';

const mappedCode = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return undefined;
  }

  return (value as { readonly code?: unknown }).code;
};

describe('mapWorkspaceError', () => {
  it('maps a tenant client foreign-key failure without leaking driver text', () => {
    const error = mapWorkspaceError({
      code: '23503',
      constraint: 'matters_organization_id_client_id_fkey',
      detail: 'sensitive database detail',
    });

    expect(mappedCode(error)).toBe('workspace.client_not_found');
    expect(String(error)).not.toContain('sensitive database detail');
  });

  it('maps a jurisdiction foreign-key failure', () => {
    const error = mapWorkspaceError({
      code: '23503',
      constraint: 'matters_jurisdiction_id_fkey',
    });

    expect(mappedCode(error)).toBe('workspace.jurisdiction_not_found');
  });

  it('maps check violations to a stable workspace validation error', () => {
    const error = mapWorkspaceError({
      code: '23514',
      constraint: 'matters_closed_state_consistent',
    });

    expect(mappedCode(error)).toBe('workspace.invalid_state');
  });

  it('maps database authorization failures', () => {
    const error = mapWorkspaceError({
      code: '42501',
    });

    expect(mappedCode(error)).toBe('authz.denied');
  });

  it('returns unknown errors unchanged', () => {
    const original = new Error('unexpected');

    expect(mapWorkspaceError(original)).toBe(original);
  });
});
