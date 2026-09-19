import { forbidden, validationError, type Clock, type UserId } from '@legalintel/kernel';

import { generateApiKey } from '../domain/api-key';
import {
  actingUserId,
  canAssignRole,
  canManageMember,
  enforce,
  type AuthzContext,
} from '../domain/authz';
import type { PermissionCatalog } from '../domain/catalog';
import type { OrgRole } from '../domain/roles';
import type { ApiKeyRecord, IamStore, StoreTx } from '../ports/iam-store';

const requireActor = (context: AuthzContext): UserId => {
  const actor = actingUserId(context);
  if (actor === null) {
    throw forbidden('authz.user_required', 'This action must be performed by a user.');
  }
  return actor;
};

export async function addMember(
  tx: StoreTx,
  store: IamStore,
  context: AuthzContext,
  userId: UserId,
): Promise<void> {
  enforce(context, 'member:invite');
  await store.addMember(tx, userId, 'active');
}

export async function removeMember(
  tx: StoreTx,
  store: IamStore,
  context: AuthzContext,
  targetUserId: UserId,
): Promise<void> {
  enforce(context, 'member:remove');
  const target = await store.loadMembership(tx, targetUserId);
  // The target's roles decide whether THIS caller may act on them: an admin cannot remove an
  // owner. The last-owner rule is enforced separately by the database.
  if (target !== null && !canManageMember(context, 'member:remove', target.roles)) {
    throw forbidden('authz.denied', 'You do not have permission to perform this action.', {
      details: { action: 'member:remove' },
    });
  }
  await store.setMemberStatus(tx, targetUserId, 'removed');
}

export async function assignRole(
  tx: StoreTx,
  store: IamStore,
  context: AuthzContext,
  targetUserId: UserId,
  role: OrgRole,
): Promise<void> {
  enforce(context, 'member:assign_role');
  const actor = requireActor(context);
  if (!canAssignRole(context, role)) {
    throw forbidden('authz.role_not_assignable', 'You cannot grant that role.', {
      details: { role },
    });
  }
  const target = await store.loadMembership(tx, targetUserId);
  if (target?.status !== 'active') {
    throw forbidden('authz.denied', 'You do not have permission to perform this action.');
  }
  await store.assignRole(tx, targetUserId, role, actor);
}

export async function revokeRole(
  tx: StoreTx,
  store: IamStore,
  context: AuthzContext,
  targetUserId: UserId,
  role: OrgRole,
): Promise<void> {
  enforce(context, 'member:assign_role');
  if (!canAssignRole(context, role)) {
    throw forbidden('authz.role_not_assignable', 'You cannot revoke that role.', {
      details: { role },
    });
  }
  await store.revokeRole(tx, targetUserId, role);
}

export interface IssueApiKeyInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date;
}

export interface IssuedApiKey {
  /** The only time the plaintext exists. Show it once, then discard it. */
  readonly plaintext: string;
  readonly record: Omit<ApiKeyRecord, 'secretHash'>;
}

/**
 * A key cannot be granted anything its issuer does not hold, or anything keys may never hold
 * (administration). Requesting either is refused rather than silently trimmed, so the caller
 * finds out instead of receiving a key that is weaker than they believe.
 */
export async function issueApiKey(
  tx: StoreTx,
  store: IamStore,
  catalog: PermissionCatalog,
  context: AuthzContext,
  input: IssueApiKeyInput,
  clock: Clock,
): Promise<IssuedApiKey> {
  enforce(context, 'api_key:create');
  const actor = requireActor(context);
  if (context.organizationId === null) {
    throw forbidden('authz.organization_required', 'An organization context is required.');
  }
  if (context.principal.kind === 'api_key') {
    throw forbidden('authz.denied', 'An API key cannot issue API keys.');
  }

  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) {
    throw validationError('api_key.name_invalid', 'A key name must be 1–100 characters.');
  }
  if (input.scopes.length === 0) {
    throw validationError('api_key.scopes_required', 'A key needs at least one scope.');
  }
  const scopes = [...new Set(input.scopes)];
  const notEligible = scopes.filter((scope) => !catalog.apiKeyEligible.has(scope));
  if (notEligible.length > 0) {
    throw validationError(
      'api_key.scope_not_eligible',
      'One or more scopes cannot be held by an API key.',
      {
        details: { scopes: notEligible },
      },
    );
  }
  const exceeding = scopes.filter((scope) => !context.permissions.has(scope));
  if (exceeding.length > 0) {
    throw forbidden(
      'api_key.scope_exceeds_issuer',
      'You cannot grant a key permissions you do not hold.',
      {
        details: { scopes: exceeding },
      },
    );
  }
  if (input.expiresAt !== undefined && input.expiresAt <= clock.now()) {
    throw validationError('api_key.expiry_in_past', 'The expiry must be in the future.');
  }

  const generated = generateApiKey(context.organizationId);
  const record = {
    id: generated.keyId,
    name,
    secretHash: generated.secretHash,
    lastFour: generated.lastFour,
    scopes,
    createdBy: actor,
    expiresAt: input.expiresAt ?? null,
  };
  await store.insertApiKey(tx, record);

  return {
    plaintext: generated.plaintext,
    record: {
      id: record.id,
      organizationId: context.organizationId,
      name,
      lastFour: record.lastFour,
      scopes,
      createdBy: actor,
      createdAt: clock.now(),
      expiresAt: record.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    },
  };
}

export async function revokeApiKey(
  tx: StoreTx,
  store: IamStore,
  context: AuthzContext,
  keyId: ApiKeyRecord['id'],
): Promise<void> {
  enforce(context, 'api_key:revoke');
  await store.revokeApiKey(tx, keyId);
}
