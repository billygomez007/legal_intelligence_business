import type { AuthzContext } from '@legalintel/iam';

/**
 * Information extracted from the HTTP request that may be used by trusted
 * server authentication code.
 *
 * None of these values is itself an AuthzContext.
 *
 * A resolver must authenticate the credential and then load the current
 * database-backed IAM context.
 */
export interface RequestAuthenticationInput {
  readonly authorization: string | null;

  readonly organizationHint: string | null;
}

/**
 * Trusted server authentication boundary.
 *
 * Implementations must return a freshly resolved AuthzContext from IAM.
 *
 * They must never construct roles, permissions or organization membership
 * directly from browser-controlled headers/body data.
 */
export interface RequestAuthResolver {
  resolve(input: RequestAuthenticationInput): Promise<AuthzContext | null>;
}
