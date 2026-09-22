import { once } from 'node:events';

import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { AuthzContext } from '@legalintel/iam';

import type { LegalResearchWorkspace } from '@legalintel/legal-synthesis';

import type { RequestAuthResolver } from '../src/auth/request-auth.js';

import type { HumanSignInService } from '../src/auth/sign-in-service.js';

import { createLawAfriqueApiServer } from '../src/server.js';

const servers: ReturnType<typeof createLawAfriqueApiServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) {
      server.close();

      await once(server, 'close');
    }
  }
});

const auth: RequestAuthResolver = {
  async resolve(): Promise<AuthzContext | null> {
    return null;
  },
};

const workspace: LegalResearchWorkspace = {
  async run() {
    throw new Error('not used');
  },
};

async function start(signIn?: HumanSignInService): Promise<string> {
  const server = createLawAfriqueApiServer({
    legalResearch: {
      auth,
      workspace,
    },

    ...(signIn !== undefined
      ? {
          signIn,
        }
      : {}),
  });

  servers.push(server);

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
}

describe('Phase 10C4A real sign-in server route', () => {
  it('serves POST /v1/auth/session through the real router', async () => {
    const base = await start({
      async signIn(request) {
        expect(request).toEqual({
          provider: 'google',

          credential: 'verified-provider-token',
        });

        return {
          sessionToken: 'law-afrique-session',

          expiresInSeconds: 3600,
        };
      },
    });

    const response = await fetch(`${base}/v1/auth/session`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        provider: 'google',

        credential: 'verified-provider-token',
      }),
    });

    expect(response.status).toBe(200);

    expect(await response.json()).toEqual({
      data: {
        sessionToken: 'law-afrique-session',

        tokenType: 'Bearer',

        expiresInSeconds: 3600,
      },
    });
  });

  it('returns route_not_found when sign-in service is not configured', async () => {
    const base = await start();

    const response = await fetch(`${base}/v1/auth/session`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        provider: 'google',

        credential: 'provider-token',
      }),
    });

    expect(response.status).toBe(404);

    expect(await response.json()).toEqual({
      error: {
        code: 'route_not_found',
      },
    });
  });

  it('rejects browser authority injection at the real network route', async () => {
    let called = false;

    const base = await start({
      async signIn() {
        called = true;

        return {
          sessionToken: 'must-not-be-issued',

          expiresInSeconds: 3600,
        };
      },
    });

    const response = await fetch(`${base}/v1/auth/session`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        provider: 'google',

        credential: 'provider-token',

        userId: '11111111-1111-4111-8111-111111111111',

        organizationId: '22222222-2222-4222-8222-222222222222',

        roles: ['owner'],

        permissions: ['*'],
      }),
    });

    expect(response.status).toBe(400);

    expect(called).toBe(false);
  });
});
