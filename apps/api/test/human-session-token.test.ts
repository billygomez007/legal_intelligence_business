import { describe, expect, it } from 'vitest';

import { UserId } from '@legalintel/kernel';

import {
  createSignedHumanSessionIdentityResolver,
  createSignedHumanSessionToken,
} from '../src/auth/human-session-token.js';

const SECRET = 'law-afrique-test-auth-secret-that-is-definitely-longer-than-32-bytes';

const OTHER_SECRET = 'law-afrique-other-secret-that-is-definitely-longer-than-32-bytes';

const userId = UserId.parse('11111111-1111-4111-8111-111111111111');

function fixedClock(iso: string) {
  return {
    now: () => new Date(iso),
  };
}

describe('Phase 10C3 signed human session tokens', () => {
  it('round-trips only the authenticated human user identity', async () => {
    const clock = fixedClock('2026-09-22T13:00:00.000Z');

    const token = createSignedHumanSessionToken(
      {
        secret: SECRET,

        clock,
      },

      {
        userId,

        expiresInSeconds: 900,
      },
    );

    const resolver = createSignedHumanSessionIdentityResolver({
      secret: SECRET,

      clock,
    });

    await expect(resolver.resolveBearer(token)).resolves.toBe(userId);
  });

  it('rejects a token signed with a different secret', async () => {
    const clock = fixedClock('2026-09-22T13:00:00.000Z');

    const token = createSignedHumanSessionToken(
      {
        secret: OTHER_SECRET,

        clock,
      },

      {
        userId,

        expiresInSeconds: 900,
      },
    );

    const resolver = createSignedHumanSessionIdentityResolver({
      secret: SECRET,

      clock,
    });

    await expect(resolver.resolveBearer(token)).resolves.toBeNull();
  });

  it('rejects expired sessions', async () => {
    const token = createSignedHumanSessionToken(
      {
        secret: SECRET,

        clock: fixedClock('2026-09-22T13:00:00.000Z'),
      },

      {
        userId,

        expiresInSeconds: 60,
      },
    );

    const resolver = createSignedHumanSessionIdentityResolver({
      secret: SECRET,

      clock: fixedClock('2026-09-22T13:02:00.000Z'),
    });

    await expect(resolver.resolveBearer(token)).resolves.toBeNull();
  });

  it('rejects modified payloads even if they remain valid JSON', async () => {
    const clock = fixedClock('2026-09-22T13:00:00.000Z');

    const token = createSignedHumanSessionToken(
      {
        secret: SECRET,

        clock,
      },

      {
        userId,

        expiresInSeconds: 900,
      },
    );

    const parts = token.split('.');

    const encodedPayload = parts[1];

    expect(encodedPayload).toBeDefined();

    const payload = JSON.parse(
      Buffer.from(encodedPayload!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    payload['sub'] = '22222222-2222-4222-8222-222222222222';

    const tampered = [
      parts[0],
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      parts[2],
    ].join('.');

    const resolver = createSignedHumanSessionIdentityResolver({
      secret: SECRET,

      clock,
    });

    await expect(resolver.resolveBearer(tampered)).resolves.toBeNull();
  });

  it('rejects oversized bearer tokens before decoding', async () => {
    const resolver = createSignedHumanSessionIdentityResolver({
      secret: SECRET,
    });

    await expect(resolver.resolveBearer('x'.repeat(5000))).resolves.toBeNull();
  });

  it('rejects malformed token structures', async () => {
    const resolver = createSignedHumanSessionIdentityResolver({
      secret: SECRET,
    });

    for (const token of ['', 'abc', 'v1.a', 'v2.a.b', 'v1.***.***']) {
      await expect(resolver.resolveBearer(token)).resolves.toBeNull();
    }
  });

  it('does not allow sessions longer than 24 hours', () => {
    expect(() =>
      createSignedHumanSessionToken(
        {
          secret: SECRET,
        },

        {
          userId,

          expiresInSeconds: 24 * 60 * 60 + 1,
        },
      ),
    ).toThrow('human_session.ttl_invalid');
  });

  it('requires a strong authentication secret', () => {
    expect(() =>
      createSignedHumanSessionIdentityResolver({
        secret: 'too-short',
      }),
    ).toThrow('human_session.secret_invalid');
  });
});
