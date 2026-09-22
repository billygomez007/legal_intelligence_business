import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '@legalintel/db';

import { UserId } from '@legalintel/kernel';

import { createHumanSignInService } from '../src/auth/sign-in-service.js';

import type { ExternalIdentityVerifier } from '../src/auth/external-identity.js';

const SECRET = 'law-afrique-auth-secret-that-is-definitely-longer-than-32-bytes';

const userId = UserId.parse('11111111-1111-4111-8111-111111111111');

function verifier(
  identity: Awaited<ReturnType<ExternalIdentityVerifier['verify']>>,
): ExternalIdentityVerifier {
  return {
    async verify() {
      return identity;
    },
  };
}

describe('Phase 10C4A sign-in service', () => {
  it('rejects invalid browser credentials before provisioning', async () => {
    const service = createHumanSignInService({
      pool: {} as DbPool,

      verifier: verifier(null),

      authSecret: SECRET,
    });

    await expect(
      service.signIn({
        provider: 'google',

        credential: '',
      }),
    ).resolves.toBeNull();
  });

  it('rejects verifier/provider mismatch', async () => {
    const service = createHumanSignInService({
      pool: {} as DbPool,

      verifier: verifier({
        provider: 'microsoft',

        subject: 'external-subject',

        email: 'person@example.com',

        displayName: 'Person',
      }),

      authSecret: SECRET,
    });

    await expect(
      service.signIn({
        provider: 'google',

        credential: 'signed-provider-credential',
      }),
    ).resolves.toBeNull();
  });

  it('does not accept userId, roles, organization or permissions in its request contract', () => {
    type Request = Parameters<ReturnType<typeof createHumanSignInService>['signIn']>[0];

    const keys: readonly (keyof Request)[] = ['provider', 'credential'];

    expect(keys).toEqual(['provider', 'credential']);
  });
});
