import { withPublicTransaction, type DbPool } from '@legalintel/db';

import { pgIamStore } from '@legalintel/iam';

import type { UserId } from '@legalintel/kernel';

import { createSignedHumanSessionToken } from './human-session-token.js';

import type { ExternalIdentityVerifier } from './external-identity.js';

const PROVIDER = /^[a-z][a-z0-9._-]{0,63}$/u;

const MAX_CREDENTIAL_BYTES = 16 * 1024;

const MAX_SUBJECT_LENGTH = 512;

const MAX_EMAIL_LENGTH = 320;

const MAX_DISPLAY_NAME_LENGTH = 256;

const SESSION_TTL_SECONDS = 60 * 60;

export interface HumanSignInRequest {
  readonly provider: string;

  readonly credential: string;
}

export interface HumanSignInResult {
  readonly sessionToken: string;

  readonly expiresInSeconds: number;
}

export interface CreateHumanSignInServiceDependencies {
  readonly pool: DbPool;

  readonly verifier: ExternalIdentityVerifier;

  readonly authSecret: string;
}

function validVerifiedText(
  value: string,

  maxLength: number,
): boolean {
  return (
    value.length > 0 && value.length <= maxLength && value.trim() === value && !value.includes('\0')
  );
}

function validEmail(value: string): boolean {
  return validVerifiedText(value, MAX_EMAIL_LENGTH) && value.includes('@');
}

function validIdentity(identity: {
  readonly provider: string;

  readonly subject: string;

  readonly email: string;

  readonly displayName: string;
}): boolean {
  return (
    PROVIDER.test(identity.provider) &&
    validVerifiedText(identity.subject, MAX_SUBJECT_LENGTH) &&
    validEmail(identity.email) &&
    validVerifiedText(identity.displayName, MAX_DISPLAY_NAME_LENGTH)
  );
}

async function provision(
  pool: DbPool,

  identity: {
    readonly provider: string;

    readonly subject: string;

    readonly email: string;

    readonly displayName: string;
  },
): Promise<UserId> {
  return withPublicTransaction(pool, (tx) => pgIamStore.provisionUser(tx, identity));
}

export function createHumanSignInService(dependencies: CreateHumanSignInServiceDependencies) {
  return Object.freeze({
    async signIn(request: HumanSignInRequest): Promise<HumanSignInResult | null> {
      if (
        !PROVIDER.test(request.provider) ||
        request.credential.length === 0 ||
        Buffer.byteLength(request.credential, 'utf8') > MAX_CREDENTIAL_BYTES ||
        request.credential.includes('\0')
      ) {
        return null;
      }

      const verified = await dependencies.verifier.verify({
        provider: request.provider,

        credential: request.credential,
      });

      if (verified === null || verified.provider !== request.provider || !validIdentity(verified)) {
        return null;
      }

      /**
       * IAM provisioning receives ONLY identity attributes returned by the
       * trusted external verifier.
       *
       * No userId, roles, organization, membership or permissions come
       * from the browser.
       */
      const userId = await provision(dependencies.pool, {
        provider: verified.provider,

        subject: verified.subject,

        email: verified.email,

        displayName: verified.displayName,
      });

      const sessionToken = createSignedHumanSessionToken(
        {
          secret: dependencies.authSecret,
        },

        {
          userId,

          expiresInSeconds: SESSION_TTL_SECONDS,
        },
      );

      return Object.freeze({
        sessionToken,

        expiresInSeconds: SESSION_TTL_SECONDS,
      });
    },
  });
}

export type HumanSignInService = ReturnType<typeof createHumanSignInService>;
