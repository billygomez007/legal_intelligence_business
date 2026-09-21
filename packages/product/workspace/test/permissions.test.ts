import { composeCatalog, permissionsForMember, platformPermissions } from '@legalintel/iam';
import { describe, expect, it } from 'vitest';

import { workspacePermissions } from '../src/authz/permissions.js';

describe('workspace permissions', () => {
  const catalog = composeCatalog([platformPermissions, workspacePermissions]);

  it('composes into the platform permission catalog', () => {
    expect(catalog.permissions.has('client:create')).toBe(true);
    expect(catalog.permissions.has('client:read')).toBe(true);
    expect(catalog.permissions.has('client:update')).toBe(true);
    expect(catalog.permissions.has('matter:create')).toBe(true);
    expect(catalog.permissions.has('matter:read')).toBe(true);
    expect(catalog.permissions.has('matter:update')).toBe(true);
  });

  it('lets owner, admin and member work with clients and matters', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      const permissions = permissionsForMember(catalog, [role]);

      expect(permissions.has('client:create')).toBe(true);
      expect(permissions.has('client:read')).toBe(true);
      expect(permissions.has('client:update')).toBe(true);

      expect(permissions.has('matter:create')).toBe(true);
      expect(permissions.has('matter:read')).toBe(true);
      expect(permissions.has('matter:update')).toBe(true);
    }
  });

  it('keeps viewer read-only', () => {
    const permissions = permissionsForMember(catalog, ['viewer']);

    expect(permissions.has('client:read')).toBe(true);
    expect(permissions.has('matter:read')).toBe(true);

    expect(permissions.has('client:create')).toBe(false);
    expect(permissions.has('client:update')).toBe(false);
    expect(permissions.has('matter:create')).toBe(false);
    expect(permissions.has('matter:update')).toBe(false);
  });
});
