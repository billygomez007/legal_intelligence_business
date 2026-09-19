import { describe, expect, it } from 'vitest';

import { composeCatalog, platformPermissions, type PermissionContribution } from '../src';
import { catalog, testProduct } from './fixtures';

const contribution = (overrides: Partial<PermissionContribution>): PermissionContribution => ({
  product: 'x',
  permissions: [{ key: 'thing:read', description: 'Read a thing.' }],
  orgRoleGrants: {
    owner: ['thing:read'],
    admin: ['thing:read'],
    member: ['thing:read'],
    viewer: ['thing:read'],
  },
  ...overrides,
});

const rejects = (contributions: PermissionContribution[], pattern: RegExp) => {
  expect(() => composeCatalog(contributions)).toThrow(pattern);
};

describe('composeCatalog', () => {
  it('composes the platform contribution with a product contribution', () => {
    expect(catalog.permissions.has('member:invite')).toBe(true);
    expect(catalog.permissions.get('project:read')?.product).toBe('test');
    expect(catalog.orgRolePermissions.get('member')?.has('project:read:own')).toBe(true);
    expect(catalog.staffRolePermissions.get('data_reviewer')?.has('corpus:review')).toBe(true);
  });

  it('never lets an API key hold platform administration', () => {
    const platformOnly = composeCatalog([platformPermissions]);
    expect(platformOnly.apiKeyEligible.size).toBe(0);
    for (const grant of catalog.apiKeyEligible) {
      expect(grant, grant).not.toMatch(/^(member|api_key|organization|audit|billing):/);
    }
  });

  it('marks only explicitly eligible permissions as API-key eligible, expanding scopes', () => {
    expect([...catalog.apiKeyEligible].sort()).toEqual([
      'corpus:read',
      'project:read:any',
      'project:read:own',
    ]);
  });

  describe('rejects an invalid catalog', () => {
    it('duplicate permission keys across contributions', () => {
      rejects([contribution({ product: 'a' }), contribution({ product: 'b' })], /defined by both/);
    });

    it('malformed permission keys', () => {
      for (const key of ['Thing:read', 'thing', 'thing:', ':read', 'thing:read:extra', 'thing:*']) {
        rejects(
          [contribution({ permissions: [{ key, description: 'x' }], orgRoleGrants: {} })],
          /lowercase resource:action/,
        );
      }
    });

    it('wildcard grants', () => {
      rejects([contribution({ orgRoleGrants: { owner: ['*'] } })], /wildcard/);
      rejects([contribution({ orgRoleGrants: { owner: ['thing:*'] } })], /wildcard/);
    });

    it('grants of undefined permissions', () => {
      rejects(
        [contribution({ orgRoleGrants: { owner: ['thing:delete'] } })],
        /not a defined permission/,
      );
    });

    it('an unscoped grant to a scoped permission, and the reverse', () => {
      const scoped = { key: 'doc:read', description: 'x', scoped: true };
      rejects(
        [contribution({ permissions: [scoped], orgRoleGrants: { owner: ['doc:read'] } })],
        /:own or :any/,
      );
      rejects(
        [contribution({ orgRoleGrants: { owner: ['thing:read:any'] } })],
        /not a defined permission/,
      );
    });

    it('a grant listed twice', () => {
      rejects([contribution({ orgRoleGrants: { owner: ['thing:read', 'thing:read'] } })], /twice/);
    });

    it('grants to an unknown organization role', () => {
      rejects(
        [contribution({ orgRoleGrants: { superuser: ['thing:read'] } as never })],
        /unknown role/,
      );
    });

    it('an invalid staff role key', () => {
      rejects(
        [contribution({ staffRoleGrants: { 'Bad Role': ['thing:read'] } })],
        /not a valid role key/,
      );
    });

    it('privilege inversion: a junior role holding something its senior lacks', () => {
      rejects(
        [
          contribution({
            orgRoleGrants: { owner: [], admin: [], member: ['thing:read'], viewer: [] },
          }),
        ],
        /"member" holds thing:read, which the more senior role "admin" lacks/,
      );
    });
  });

  it('treats :any as covering :own when checking role hierarchy', () => {
    // admin holds only project:read:any while member holds project:read:own. Not an inversion.
    expect(() => composeCatalog([platformPermissions, testProduct])).not.toThrow();
    expect(catalog.orgRolePermissions.get('admin')?.has('project:read:own')).toBe(false);
  });
});
