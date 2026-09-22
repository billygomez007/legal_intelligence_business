import type { AuthzContext } from '@legalintel/iam';

import { workProductPermissionKeys, type WorkProductPermission } from './permissions.js';

export class WorkProductAccessError extends Error {
  readonly code = 'authz.denied';

  constructor() {
    super('Work product access denied.');
    this.name = 'WorkProductAccessError';
  }
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
  );
}

/**
 * Consume a freshly resolved IAM context, never a client-supplied context.
 * resourceOrganizationId must come from the server-loaded resource.
 * These checks do not replace membership resolution, RLS, or transactions.
 */
export function requireWorkProductPermission(
  context: AuthzContext,
  resourceOrganizationId: string,
  permission: WorkProductPermission,
): string {
  const principal = context.principal;

  if (
    principal.kind !== 'user' ||
    !validId(principal.userId) ||
    !validId(context.organizationId) ||
    !validId(resourceOrganizationId) ||
    context.organizationId !== resourceOrganizationId ||
    !workProductPermissionKeys.includes(permission) ||
    !context.permissions.has(permission)
  ) {
    throw new WorkProductAccessError();
  }

  return principal.userId;
}
