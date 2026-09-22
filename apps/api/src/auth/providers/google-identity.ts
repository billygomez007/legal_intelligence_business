import { OAuth2Client } from 'google-auth-library';

import type {
  ExternalIdentityCredential,
  ExternalIdentityVerifier,
  VerifiedExternalIdentity,
} from '../external-identity.js';

const PROVIDER = 'google';

const MAX_ID_TOKEN_BYTES = 16 * 1024;

const MAX_SUBJECT_LENGTH = 512;

const MAX_EMAIL_LENGTH = 320;

const MAX_DISPLAY_NAME_LENGTH = 256;

const CLIENT_ID = /^[A-Za-z0-9._:-]{8,512}$/u;

export interface GoogleIdTokenPayload {
  readonly sub?: string;

  readonly email?: string;

  readonly email_verified?: boolean;

  readonly name?: string;
}

export interface GoogleLoginTicket {
  getPayload(): GoogleIdTokenPayload | undefined;
}

export interface GoogleIdTokenVerificationClient {
  verifyIdToken(options: {
    readonly idToken: string;

    readonly audience: string;
  }): Promise<GoogleLoginTicket>;
}

export interface CreateGoogleExternalIdentityVerifierDependencies {
  readonly clientId: string;

  /**
   * Test seam.
   *
   * Production uses Google's official OAuth2Client.
   */
  readonly client?: GoogleIdTokenVerificationClient;
}

function validClaim(
  value: string,

  maxLength: number,
): boolean {
  return (
    value.length > 0 && value.length <= maxLength && value.trim() === value && !value.includes('\0')
  );
}

function verifiedIdentity(payload: GoogleIdTokenPayload): VerifiedExternalIdentity | null {
  if (typeof payload.sub !== 'string' || !validClaim(payload.sub, MAX_SUBJECT_LENGTH)) {
    return null;
  }

  if (
    typeof payload.email !== 'string' ||
    payload.email_verified !== true ||
    !validClaim(payload.email, MAX_EMAIL_LENGTH) ||
    !payload.email.includes('@')
  ) {
    return null;
  }

  const displayName =
    typeof payload.name === 'string' && validClaim(payload.name.trim(), MAX_DISPLAY_NAME_LENGTH)
      ? payload.name.trim()
      : payload.email;

  return Object.freeze({
    provider: PROVIDER,

    /**
     * Google's `sub` is the durable identity key.
     *
     * Email is profile metadata only and is never used as the IAM identity
     * key.
     */
    subject: payload.sub,

    email: payload.email,

    displayName,
  });
}

export function createGoogleExternalIdentityVerifier(
  dependencies: CreateGoogleExternalIdentityVerifierDependencies,
): ExternalIdentityVerifier {
  if (!CLIENT_ID.test(dependencies.clientId)) {
    throw new Error('google_identity.client_id_invalid');
  }

  const client: GoogleIdTokenVerificationClient = dependencies.client ?? new OAuth2Client();

  return Object.freeze({
    async verify(input: ExternalIdentityCredential): Promise<VerifiedExternalIdentity | null> {
      if (input.provider !== PROVIDER) {
        return null;
      }

      if (
        input.credential.length === 0 ||
        Buffer.byteLength(input.credential, 'utf8') > MAX_ID_TOKEN_BYTES ||
        input.credential.includes('\0')
      ) {
        return null;
      }

      try {
        /**
         * Google's verifyIdToken() verifies the signed Google ID token
         * against Google's certificates and validates the configured
         * audience.
         *
         * Google also validates token issuer and expiration in this flow.
         */
        const ticket = await client.verifyIdToken({
          idToken: input.credential,

          audience: dependencies.clientId,
        });

        const payload = ticket.getPayload();

        if (payload === undefined) {
          return null;
        }

        return verifiedIdentity(payload);
      } catch {
        /**
         * Provider verification failures are intentionally collapsed to null.
         * Raw Google errors are never returned to the browser.
         */
        return null;
      }
    },
  });
}
