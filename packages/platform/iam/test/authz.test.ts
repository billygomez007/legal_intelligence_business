import { ApiKeyId, OrganizationId, UserId } from '@legalintel/kernel';
import { describe, expect, it } from 'vitest';

import {
  assignableRoles,
  authorize,
  canAssignRole,
  canManageMember,
  enforce,
  permissionsForApiKey,
  permissionsForMember,
  permissionsForStaff,
  scopeFor,
  type AuthzContext,
  type OrgRole,
} from '../src';
import { catalog } from './fixtures';

const org = OrganizationId.generate();
const otherOrg = OrganizationId.generate();
const alice = UserId.generate();
const bob = UserId.generate();

const userContext = (roles: OrgRole[], userId = alice): AuthzContext => ({
  principal: { kind: 'user', userId },
  organizationId: org,
  roles,
  permissions: permissionsForMember(catalog, roles),
});

describe('authorize', () => {
  it('denies by default', () => {
    const nobody = userContext([]);
    expect(authorize(nobody, 'project:create')).toEqual({
      allowed: false,
      reason: 'no_permission',
    });
    expect(authorize(nobody, 'no:such_action')).toEqual({
      allowed: false,
      reason: 'no_permission',
    });
  });

  it('allows an unscoped permission the role holds', () => {
    expect(authorize(userContext(['member']), 'project:create')).toEqual({ allowed: true });
    expect(authorize(userContext(['viewer']), 'project:create').allowed).toBe(false);
  });

  it('honours own versus any', () => {
    const member = userContext(['member']);
    expect(authorize(member, 'project:update', { ownerId: alice }).allowed).toBe(true);
    expect(authorize(member, 'project:update', { ownerId: bob })).toEqual({
      allowed: false,
      reason: 'not_owner',
    });
    // No resource given: an own-only holder cannot be authorised in the abstract.
    expect(authorize(member, 'project:update').allowed).toBe(false);

    const admin = userContext(['admin']);
    expect(authorize(admin, 'project:update', { ownerId: bob }).allowed).toBe(true);
  });

  it('refuses a resource from another organization even when the permission is held', () => {
    expect(authorize(userContext(['owner']), 'project:read', { organizationId: otherOrg })).toEqual(
      {
        allowed: false,
        reason: 'cross_tenant',
      },
    );
    expect(authorize(userContext(['owner']), 'project:read', { organizationId: org }).allowed).toBe(
      true,
    );
  });

  it('treats an API key as acting for its creator when applying ownership', () => {
    const key: AuthzContext = {
      principal: { kind: 'api_key', apiKeyId: ApiKeyId.generate(), createdBy: alice },
      organizationId: org,
      roles: [],
      permissions: new Set(['project:read:own']),
    };
    expect(authorize(key, 'project:read', { ownerId: alice }).allowed).toBe(true);
    expect(authorize(key, 'project:read', { ownerId: bob }).allowed).toBe(false);
  });

  it('gives a system principal no ownership, so own-scoped permissions never apply to it', () => {
    const system: AuthzContext = {
      principal: { kind: 'system', name: 'indexer' },
      organizationId: org,
      roles: [],
      permissions: new Set(['project:read:own']),
    };
    expect(authorize(system, 'project:read', { ownerId: alice }).allowed).toBe(false);
  });
});

describe('scopeFor (list endpoints)', () => {
  it('reports how much a caller may see', () => {
    expect(scopeFor(userContext(['admin']), 'project:read')).toBe('any');
    expect(scopeFor(userContext(['member']), 'project:read')).toBe('own');
    expect(scopeFor(userContext([]), 'project:read')).toBeNull();
    // A member holds project:create outright (unscoped), but not member:invite.
    expect(scopeFor(userContext(['member']), 'project:create')).toBe('any');
    expect(scopeFor(userContext(['member']), 'member:invite')).toBeNull();
  });
});

describe('enforce', () => {
  it('passes silently when allowed', () => {
    expect(() => {
      enforce(userContext(['admin']), 'member:invite');
    }).not.toThrow();
  });

  it('throws forbidden with a stable code and no internals when denied', () => {
    expect(() => {
      enforce(userContext(['viewer']), 'member:invite');
    }).toThrow(expect.objectContaining({ kind: 'forbidden', code: 'authz.denied' }) as Error);
  });

  it('reports a cross-tenant reference as not found, never forbidden', () => {
    expect(() => {
      enforce(userContext(['owner']), 'project:read', { organizationId: otherOrg });
    }).toThrow(expect.objectContaining({ kind: 'not_found' }) as Error);
  });
});

describe('effective permissions', () => {
  it('unions the permissions of every role a member holds', () => {
    const both = permissionsForMember(catalog, ['viewer', 'admin']);
    expect(both.has('project:update:any')).toBe(true);
    expect(both.has('project:read:own')).toBe(true);
  });

  it('ignores unknown staff roles', () => {
    expect([...permissionsForStaff(catalog, ['data_reviewer', 'made_up'])]).toEqual([
      'corpus:review',
    ]);
  });

  it('keeps reviewing and publishing in separate staff roles (separation of duties)', () => {
    const reviewer = permissionsForStaff(catalog, ['data_reviewer']);
    const publisher = permissionsForStaff(catalog, ['data_publisher']);
    expect(reviewer.has('corpus:publish')).toBe(false);
    expect(publisher.has('corpus:review')).toBe(false);
  });

  describe('API keys', () => {
    const adminPermissions = permissionsForMember(catalog, ['admin']);

    it('are limited to eligible scopes the issuer currently holds', () => {
      const granted = permissionsForApiKey(
        catalog,
        ['corpus:read', 'project:read:any', 'member:invite', 'project:update:any'],
        adminPermissions,
      );
      // member:invite and project:update:any are not key-eligible, whatever the issuer holds.
      expect([...granted].sort()).toEqual(['corpus:read', 'project:read:any']);
    });

    it('lose power immediately when the issuer is demoted', () => {
      const scopes = ['project:read:any', 'corpus:read'];
      const asAdmin = permissionsForApiKey(catalog, scopes, adminPermissions);
      const asViewer = permissionsForApiKey(
        catalog,
        scopes,
        permissionsForMember(catalog, ['viewer']),
      );
      expect(asAdmin.has('project:read:any')).toBe(true);
      expect(asViewer.has('project:read:any')).toBe(false);
      expect(asViewer.has('corpus:read')).toBe(true);
    });

    it('have no permissions at all if the issuer no longer holds any', () => {
      expect(permissionsForApiKey(catalog, ['corpus:read'], new Set()).size).toBe(0);
    });
  });
});

describe('role-assignment rules', () => {
  it('lets an owner assign any role', () => {
    expect(assignableRoles(userContext(['owner'])).sort()).toEqual([
      'admin',
      'member',
      'owner',
      'viewer',
    ]);
  });

  it('stops an admin granting owner or admin, which would let them promote themselves', () => {
    const admin = userContext(['admin']);
    expect(assignableRoles(admin).sort()).toEqual(['member', 'viewer']);
    expect(canAssignRole(admin, 'owner')).toBe(false);
    expect(canAssignRole(admin, 'admin')).toBe(false);
  });

  it('gives members and viewers no assignment power even if the permission were somehow held', () => {
    const member: AuthzContext = {
      ...userContext(['member']),
      permissions: new Set(['member:assign_role']),
    };
    expect(assignableRoles(member)).toEqual([]);
  });

  it('requires the assignment permission, not just a senior role', () => {
    const stripped: AuthzContext = { ...userContext(['owner']), permissions: new Set() };
    expect(assignableRoles(stripped)).toEqual([]);
  });

  it('stops an admin removing or re-roling an owner or another admin', () => {
    const admin = userContext(['admin']);
    expect(canManageMember(admin, 'member:remove', ['member'])).toBe(true);
    expect(canManageMember(admin, 'member:remove', ['viewer', 'member'])).toBe(true);
    expect(canManageMember(admin, 'member:remove', ['owner'])).toBe(false);
    expect(canManageMember(admin, 'member:remove', ['admin'])).toBe(false);
    expect(canManageMember(admin, 'member:remove', ['member', 'owner'])).toBe(false);
  });

  it('lets an owner manage anyone', () => {
    expect(canManageMember(userContext(['owner']), 'member:remove', ['owner', 'admin'])).toBe(true);
  });
});
