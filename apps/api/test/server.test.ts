import { once } from 'node:events';

import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { AuthzContext } from '@legalintel/iam';

import type { LegalResearchWorkspace } from '@legalintel/legal-synthesis';

import type { RequestAuthResolver } from '../src/auth/request-auth.js';

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

const context = {
  principal: {
    kind: 'user',

    userId: '11111111-1111-4111-8111-111111111111',
  },

  organizationId: '22222222-2222-4222-8222-222222222222',

  roles: ['member'],

  permissions: new Set(['ai_task:read', 'matter:read', 'work_product:read']),
} as unknown as AuthzContext;

function auth(value: AuthzContext | null): RequestAuthResolver {
  return {
    async resolve() {
      return value;
    },
  };
}

function workspace(): LegalResearchWorkspace {
  return {
    async run(request) {
      return {
        question: request.question,

        summary: 'Synthetic grounded result.',

        propositions: [],

        unresolvedIssues: [],

        insufficientEvidence: false,

        authoritativeLegalSource: false,

        humanReviewRequired: true,
      };
    },
  };
}

async function start(resolver: RequestAuthResolver) {
  const server = createLawAfriqueApiServer({
    legalResearch: {
      auth: resolver,

      workspace: workspace(),
    },
  });

  servers.push(server);

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
}

describe('Phase 10C1 Law Afrique API', () => {
  it('serves a minimal health endpoint', async () => {
    const base = await start(auth(context));

    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);

    expect(await response.json()).toEqual({
      status: 'ok',

      service: 'law-afrique-api',
    });
  });

  it('requires authenticated server context for legal research', async () => {
    const base = await start(auth(null));

    const response = await fetch(`${base}/v1/legal-research`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        taskId: 'task',

        question: 'Question',
      }),
    });

    expect(response.status).toBe(401);

    expect(await response.json()).toEqual({
      error: {
        code: 'authentication_required',
      },
    });
  });

  it('passes only resolved AuthzContext to Phase 10B', async () => {
    const base = await start(auth(context));

    const response = await fetch(`${base}/v1/legal-research`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',

        authorization: 'Bearer synthetic',

        'x-organization-id': '22222222-2222-4222-8222-222222222222',
      },

      body: JSON.stringify({
        taskId: 'task',

        question: 'Synthetic question',
      }),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        authoritativeLegalSource: boolean;

        humanReviewRequired: boolean;
      };
    };

    expect(body.data.authoritativeLegalSource).toBe(false);

    expect(body.data.humanReviewRequired).toBe(true);
  });

  it('still rejects tenant injection through the real HTTP route', async () => {
    const base = await start(auth(context));

    const response = await fetch(`${base}/v1/legal-research`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        taskId: 'task',

        question: 'Question',

        organizationId: 'attacker-org',
      }),
    });

    expect(response.status).toBe(400);

    expect(await response.json()).toEqual({
      error: {
        code: 'request_field_not_allowed',
      },
    });
  });

  it('does not expose malformed JSON parser details', async () => {
    const base = await start(auth(context));

    const response = await fetch(`${base}/v1/legal-research`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: '{not-json',
    });

    expect(response.status).toBe(400);

    expect(await response.json()).toEqual({
      error: {
        code: 'request_invalid',
      },
    });
  });

  it('returns 404 for unknown routes', async () => {
    const base = await start(auth(context));

    const response = await fetch(`${base}/no-such-route`);

    expect(response.status).toBe(404);
  });
});
