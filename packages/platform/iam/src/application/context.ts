import { withTenantTransaction, type DbPool } from '@legalintel/db';
import {
  forbidden,
  notFound,
  unauthenticated,
  type Clock,
  type OrganizationId,
  type UserId,
} from '@legalintel/kernel';

import { DUMMY_SECRET_HASH, parseApiKey, verifyApiKeySecret } from '../domain/api-key';
import { permissionsForApiKey, permissionsForMember, type AuthzContext } from '../domain/authz';
import type { PermissionCatalog } from '../domain/catalog';
import type { IamStore } from '../ports/iam-store';

export interface IamDeps {
  readonly pool: DbPool;
  readonly store: IamStore;
  readonly catalog: PermissionCatalog;
  readonly clock: Clock;
}

/**
 * Resolves what an active signed-in user may do in an organization. Built from the database, never
 * from anything the client claims. A user who is not an active member is told the
 * organization does not exist: "forbidden" would confirm it does.
 */
export async function loadUserContext(
  deps: IamDeps,
  userId: UserId,
  organizationId: OrganizationId,
): Promise<AuthzContext> {
  const { organization, membership } = await withTenantTransaction(
    deps.pool,
    { organizationId, userId },
    async (tx) => ({
      organization: await deps.store.loadOrganization(tx),
      membership: await deps.store.loadMembership(tx, userId),
    }),
    { readOnly: true },
  );

  if (organization === null || membership?.status !== 'active') {
    throw notFound('organization.not_found', 'Organization not found.');
  }
  if (organization.status !== 'active') {
    throw forbidden('organization.inactive', 'This organization is not active.');
  }

  return {
    principal: { kind: 'user', userId },
    organizationId,
    roles: membership.roles,
    permissions: permissionsForMember(deps.catalog, membership.roles),
  };
}

const invalidKey = () => unauthenticated('auth.invalid_api_key', 'Invalid API key.');

/**
 * Authenticates a presented API key. Every failure (malformed, unknown, wrong secret, revoked,
 * expired, issuer removed or account inactive, organization inactive) returns the identical error, so a caller
 * learns nothing about which keys exist or why one was refused.
 */
export async function authenticateApiKey(deps: IamDeps, presented: string): Promise<AuthzContext> {
  const parsed = parseApiKey(presented);
  if (parsed === null) throw invalidKey();

  const outcome = await withTenantTransaction(
    deps.pool,
    { organizationId: parsed.organizationId },
    async (tx) => {
      const record = await deps.store.findApiKey(tx, parsed.keyId);

      // Always do the hash comparison, even when there is no such key, so response time does
      // not distinguish "no such key" from "wrong secret".
      const secretOk = verifyApiKeySecret(parsed.secret, record?.secretHash ?? DUMMY_SECRET_HASH);
      if (record === null || !secretOk) return null;

      const now = deps.clock.now();
      if (record.revokedAt !== null) return null;
      if (record.expiresAt !== null && record.expiresAt <= now) return null;

      const organization = await deps.store.loadOrganization(tx);
      const issuer = await deps.store.loadMembership(tx, record.createdBy);
      if (organization?.status !== 'active' || issuer?.status !== 'active') return null;

      await deps.store.touchApiKey(tx, record.id);
      return { record, issuerRoles: issuer.roles };
    },
  );

  if (outcome === null) throw invalidKey();

  const issuerPermissions = permissionsForMember(deps.catalog, outcome.issuerRoles);
  return {
    principal: {
      kind: 'api_key',
      apiKeyId: outcome.record.id,
      createdBy: outcome.record.createdBy,
    },
    organizationId: parsed.organizationId,
    roles: [],
    permissions: permissionsForApiKey(deps.catalog, outcome.record.scopes, issuerPermissions),
  };
}
