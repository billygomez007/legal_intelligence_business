import { describe, expect, it, vi } from 'vitest';

import {
  createGoogleExternalIdentityVerifier,
  type GoogleIdTokenVerificationClient,
} from '../src/auth/providers/google-identity.js';

const CLIENT_ID = '123456789-law-afrique.apps.googleusercontent.com';

function clientWithPayload(
  payload:
    | {
        readonly sub?: string;
        readonly email?: string;
        readonly email_verified?: boolean;
        readonly name?: string;
      }
    | undefined,
): GoogleIdTokenVerificationClient {
  return {
    async verifyIdToken() {
      return {
        getPayload() {
          return payload;
        },
      };
    },
  };
}

describe('Phase 10C4B Google external identity verifier', () => {
  it('returns a verified Google identity using sub as the durable subject', async () => {
    const verifyIdToken = vi.fn(
      clientWithPayload({
        sub: 'google-subject-123',

        email: 'person@example.com',

        email_verified: true,

        name: 'Person Example',
      }).verifyIdToken,
    );

    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: {
        verifyIdToken,
      },
    });

    await expect(
      verifier.verify({
        provider: 'google',

        credential: 'signed-google-id-token',
      }),
    ).resolves.toEqual({
      provider: 'google',

      subject: 'google-subject-123',

      email: 'person@example.com',

      displayName: 'Person Example',
    });

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token',

      audience: CLIENT_ID,
    });
  });

  it('uses Google sub rather than email as the IAM identity key', async () => {
    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: clientWithPayload({
        sub: 'stable-google-sub',

        email: 'changeable@example.com',

        email_verified: true,

        name: 'Person',
      }),
    });

    const identity = await verifier.verify({
      provider: 'google',

      credential: 'token',
    });

    expect(identity?.subject).toBe('stable-google-sub');

    expect(identity?.subject).not.toBe(identity?.email);
  });

  it('rejects non-Google provider selection before provider verification', async () => {
    const verifyIdToken = vi.fn();

    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: {
        verifyIdToken,
      },
    });

    await expect(
      verifier.verify({
        provider: 'microsoft',

        credential: 'provider-token',
      }),
    ).resolves.toBeNull();

    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('requires email_verified=true', async () => {
    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: clientWithPayload({
        sub: 'google-subject-123',

        email: 'person@example.com',

        email_verified: false,

        name: 'Person',
      }),
    });

    await expect(
      verifier.verify({
        provider: 'google',

        credential: 'token',
      }),
    ).resolves.toBeNull();
  });

  it('rejects a payload without sub', async () => {
    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: clientWithPayload({
        email: 'person@example.com',

        email_verified: true,

        name: 'Person',
      }),
    });

    await expect(
      verifier.verify({
        provider: 'google',

        credential: 'token',
      }),
    ).resolves.toBeNull();
  });

  it('falls back to verified email when Google name is unavailable', async () => {
    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: clientWithPayload({
        sub: 'google-subject-123',

        email: 'person@example.com',

        email_verified: true,
      }),
    });

    await expect(
      verifier.verify({
        provider: 'google',

        credential: 'token',
      }),
    ).resolves.toEqual({
      provider: 'google',

      subject: 'google-subject-123',

      email: 'person@example.com',

      displayName: 'person@example.com',
    });
  });

  it('collapses Google verification exceptions to authentication failure', async () => {
    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: {
        async verifyIdToken() {
          throw new Error('provider failure');
        },
      },
    });

    await expect(
      verifier.verify({
        provider: 'google',

        credential: 'invalid-token',
      }),
    ).resolves.toBeNull();
  });

  it('rejects oversized credentials before invoking Google verification', async () => {
    const verifyIdToken = vi.fn();

    const verifier = createGoogleExternalIdentityVerifier({
      clientId: CLIENT_ID,

      client: {
        verifyIdToken,
      },
    });

    await expect(
      verifier.verify({
        provider: 'google',

        credential: 'x'.repeat(20_000),
      }),
    ).resolves.toBeNull();

    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('requires a configured Google client ID', () => {
    expect(() =>
      createGoogleExternalIdentityVerifier({
        clientId: '',
      }),
    ).toThrow('google_identity.client_id_invalid');
  });
});
