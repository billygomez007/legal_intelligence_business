import { loadUserContext, type AuthzContext, type IamDeps } from '@legalintel/iam';

import { OrganizationId, type UserId } from '@legalintel/kernel';

import type { RequestAuthResolver, RequestAuthenticationInput } from './request-auth.js';

/**
 * Authentication technology boundary.
 *
 * OAuth/OIDC/session-cookie/JWT verification belongs here, outside IAM.
 *
 * The verifier returns ONLY a trusted user identity.
 *
 * It must never return roles, permissions or tenant authority.
 */
export interface HumanSessionIdentityResolver {
  resolveBearer(token: string): Promise<UserId | null>;
}

type LoadUserContext = typeof loadUserContext;

export interface CreateIamRequestAuthResolverDependencies {
  readonly iam: IamDeps;

  readonly sessions: HumanSessionIdentityResolver;

  /**
   * Test seam only.
   *
   * Production defaults to the real IAM loadUserContext().
   */
  readonly loadUserContext?: LoadUserContext;
}

function bearerToken(authorization: string | null): string | null {
  if (authorization === null) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/u.exec(authorization);

  return match?.[1] ?? null;
}

function expectedIamRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const record = error as Record<string, unknown>;

  return (
    record['kind'] === 'not_found' ||
    record['kind'] === 'forbidden' ||
    record['kind'] === 'unauthenticated' ||
    record['code'] === 'organization.not_found' ||
    record['code'] === 'organization.inactive'
  );
}

/**
 * Resolves a real server IAM context for a human user.
 *
 * Security model:
 *
 * 1. Bearer verifier authenticates user identity only.
 * 2. x-organization-id is merely a requested organization.
 * 3. OrganizationId parser rejects malformed IDs.
 * 4. loadUserContext() re-reads organization and active membership.
 * 5. Roles and permissions are rebuilt from the authoritative catalog.
 *
 * Therefore changing x-organization-id cannot grant access to another tenant.
 */
export function createIamRequestAuthResolver(
  dependencies: CreateIamRequestAuthResolverDependencies,
): RequestAuthResolver {
  const resolveContext = dependencies.loadUserContext ?? loadUserContext;

  return Object.freeze({
    async resolve(input: RequestAuthenticationInput): Promise<AuthzContext | null> {
      const token = bearerToken(input.authorization);

      if (token === null || input.organizationHint === null) {
        return null;
      }

      let organizationId: OrganizationId;

      try {
        organizationId = OrganizationId.parse(input.organizationHint);
      } catch {
        return null;
      }

      const userId = await dependencies.sessions.resolveBearer(token);

      if (userId === null) {
        return null;
      }

      try {
        const context = await resolveContext(dependencies.iam, userId, organizationId);

        if (context.principal.kind !== 'user') {
          return null;
        }

        return context;
      } catch (error: unknown) {
        if (expectedIamRejection(error)) {
          return null;
        }

        /**
         * Infrastructure failures are NOT converted into authentication
         * failures. They bubble to the final HTTP boundary and become a
         * sanitized 500 response rather than a misleading 401.
         */
        throw error;
      }
    },
  });
}
