import {
  forbidden,
  notFound,
  type ApiKeyId,
  type OrganizationId,
  type UserId,
} from '@legalintel/kernel';

import type { PermissionCatalog } from './catalog';
import type { OrgRole } from './roles';

export type Principal =
  | { readonly kind: 'user'; readonly userId: UserId }
  | { readonly kind: 'api_key'; readonly apiKeyId: ApiKeyId; readonly createdBy: UserId }
  | { readonly kind: 'system'; readonly name: string };

/**
 * Everything needed to answer "may this caller do X?", resolved once per request. Built by
 * the application layer from the database; never from anything the client sends.
 */
export interface AuthzContext {
  readonly principal: Principal;
  readonly organizationId: OrganizationId | null;
  /** Effective grants, e.g. `project:update:own`, `audit:read`. */
  readonly permissions: ReadonlySet<string>;
  /** Roles held in the organization. Empty for API keys and system principals. */
  readonly roles: readonly OrgRole[];
}

export interface ResourceRef {
  readonly ownerId?: UserId;
  readonly organizationId?: OrganizationId;
}

export type DenyReason = 'no_permission' | 'not_owner' | 'cross_tenant';
export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: DenyReason };

const ALLOW: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

/** The user an action is performed on behalf of, for "own" semantics. */
export function actingUserId(context: AuthzContext): UserId | null {
  switch (context.principal.kind) {
    case 'user':
      return context.principal.userId;
    case 'api_key':
      return context.principal.createdBy;
    case 'system':
      return null;
  }
}

/**
 * Deny by default. `action` is `resource:action`; the context holds `action`, `action:own`
 * or `action:any`. A resource from another organization is refused outright even if the
 * caller holds the permission here: the database also refuses, this is the second wall.
 */
export function authorize(context: AuthzContext, action: string, resource?: ResourceRef): Decision {
  if (
    resource?.organizationId !== undefined &&
    resource.organizationId !== context.organizationId
  ) {
    return deny('cross_tenant');
  }
  if (context.permissions.has(`${action}:any`) || context.permissions.has(action)) return ALLOW;

  if (context.permissions.has(`${action}:own`)) {
    const actor = actingUserId(context);
    if (resource?.ownerId !== undefined && actor !== null && resource.ownerId === actor) {
      return ALLOW;
    }
    return deny('not_owner');
  }
  return deny('no_permission');
}

/**
 * For list endpoints: which rows may the caller see? `any` = all, `own` = filter to the
 * caller's, `null` = none.
 */
export function scopeFor(context: AuthzContext, action: string): 'any' | 'own' | null {
  if (context.permissions.has(`${action}:any`) || context.permissions.has(action)) return 'any';
  if (context.permissions.has(`${action}:own`)) return 'own';
  return null;
}

/**
 * Throws instead of returning. A cross-tenant reference is reported as "not found", never
 * "forbidden": answering "forbidden" confirms the record exists.
 */
export function enforce(context: AuthzContext, action: string, resource?: ResourceRef): void {
  const decision = authorize(context, action, resource);
  if (decision.allowed) return;
  if (decision.reason === 'cross_tenant') {
    throw notFound('resource.not_found', 'The requested resource was not found.');
  }
  throw forbidden('authz.denied', 'You do not have permission to perform this action.', {
    details: { action },
  });
}

// ---------------------------------------------------------------------------------------
// Building effective permissions
// ---------------------------------------------------------------------------------------

export function permissionsForMember(
  catalog: PermissionCatalog,
  roles: readonly OrgRole[],
): Set<string> {
  const result = new Set<string>();
  for (const role of roles) {
    for (const grant of catalog.orgRolePermissions.get(role) ?? []) result.add(grant);
  }
  return result;
}

export function permissionsForStaff(
  catalog: PermissionCatalog,
  staffRoles: readonly string[],
): Set<string> {
  const result = new Set<string>();
  for (const role of staffRoles) {
    for (const grant of catalog.staffRolePermissions.get(role) ?? []) result.add(grant);
  }
  return result;
}

/**
 * An API key can never do more than the person who issued it can do *now*. Scopes are
 * intersected with the issuer's current permissions and with what keys may hold at all, so
 * demoting or removing the issuer immediately narrows or disables their keys. (Without this
 * a key is a confused deputy that outlives the authority it was created with.)
 */
export function permissionsForApiKey(
  catalog: PermissionCatalog,
  scopes: readonly string[],
  issuerPermissions: ReadonlySet<string>,
): Set<string> {
  return new Set(
    scopes.filter((scope) => catalog.apiKeyEligible.has(scope) && issuerPermissions.has(scope)),
  );
}

// ---------------------------------------------------------------------------------------
// Role-assignment rules. Holding `member:assign_role` is not enough: an admin who could
// grant "owner" could promote themselves, and one who could remove an owner could take over.
// ---------------------------------------------------------------------------------------

const ASSIGNABLE: Readonly<Record<OrgRole, readonly OrgRole[]>> = {
  owner: ['owner', 'admin', 'member', 'viewer'],
  admin: ['member', 'viewer'],
  member: [],
  viewer: [],
};

export function assignableRoles(context: AuthzContext): OrgRole[] {
  if (!context.permissions.has('member:assign_role')) return [];
  const result = new Set<OrgRole>();
  for (const role of context.roles) {
    for (const assignable of ASSIGNABLE[role]) result.add(assignable);
  }
  return [...result];
}

/** May the caller grant or revoke `role`? */
export function canAssignRole(context: AuthzContext, role: OrgRole): boolean {
  return assignableRoles(context).includes(role);
}

/**
 * May the caller suspend or remove a member who holds `targetRoles`? Only someone who could
 * also assign every one of those roles may, so an admin cannot remove an owner.
 */
export function canManageMember(
  context: AuthzContext,
  action: 'member:remove' | 'member:assign_role',
  targetRoles: readonly OrgRole[],
): boolean {
  if (!context.permissions.has(action)) return false;
  const allowed = new Set<OrgRole>();
  for (const role of context.roles) {
    for (const assignable of ASSIGNABLE[role]) allowed.add(assignable);
  }
  return targetRoles.every((role) => allowed.has(role));
}
