import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleSignInRoute } from '../src/http/sign-in-route.js';

function request(body: unknown): IncomingMessage {
  const stream = Readable.from([JSON.stringify(body)]);

  return Object.assign(stream, {
    method: 'POST',

    headers: {},
  }) as IncomingMessage;
}

function response() {
  let statusCode = 0;

  let output = '';

  const headers = new Map<string, string>();

  const res = {
    get statusCode() {
      return statusCode;
    },

    set statusCode(value: number) {
      statusCode = value;
    },

    setHeader(
      name: string,

      value: string,
    ) {
      headers.set(name, value);
    },

    end(value?: string) {
      output += value ?? '';
    },
  } as unknown as ServerResponse;

  return {
    res,

    status: () => statusCode,

    body: () => JSON.parse(output) as unknown,
  };
}

describe('Phase 10C4A sign-in HTTP route', () => {
  it('issues a bearer session after trusted verification/provisioning', async () => {
    const signIn = vi.fn(async () => ({
      sessionToken: 'signed.session.token',

      expiresInSeconds: 3600,
    }));

    const target = response();

    await handleSignInRoute(
      {
        signIn,
      },
      request({
        provider: 'google',

        credential: 'provider-token',
      }),
      target.res,
    );

    expect(target.status()).toBe(200);

    expect(target.body()).toEqual({
      data: {
        sessionToken: 'signed.session.token',

        tokenType: 'Bearer',

        expiresInSeconds: 3600,
      },
    });
  });

  it('rejects client-supplied user authority fields', async () => {
    const signIn = vi.fn();

    const target = response();

    await handleSignInRoute(
      {
        signIn,
      },
      request({
        provider: 'google',

        credential: 'provider-token',

        userId: '11111111-1111-4111-8111-111111111111',

        organizationId: '22222222-2222-4222-8222-222222222222',

        roles: ['owner'],

        permissions: ['*'],
      }),
      target.res,
    );

    expect(target.status()).toBe(400);

    expect(signIn).not.toHaveBeenCalled();
  });

  it('does not reveal provider verification failure details', async () => {
    const target = response();

    await handleSignInRoute(
      {
        async signIn() {
          return null;
        },
      },
      request({
        provider: 'google',

        credential: 'bad-provider-token',
      }),
      target.res,
    );

    expect(target.status()).toBe(401);

    expect(target.body()).toEqual({
      error: {
        code: 'authentication_failed',
      },
    });
  });
});
