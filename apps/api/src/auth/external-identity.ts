export interface ExternalIdentityCredential {
  readonly provider: string;

  readonly credential: string;
}

export interface VerifiedExternalIdentity {
  readonly provider: string;

  readonly subject: string;

  readonly email: string;

  readonly displayName: string;
}

/**
 * Trust boundary for Google, Microsoft, Auth0, Clerk, etc.
 *
 * Implementations must cryptographically verify the external provider
 * credential before returning an identity.
 *
 * The API must never trust provider/subject/email/displayName directly
 * from the request body as verified identity attributes.
 */
export interface ExternalIdentityVerifier {
  verify(input: ExternalIdentityCredential): Promise<VerifiedExternalIdentity | null>;
}
