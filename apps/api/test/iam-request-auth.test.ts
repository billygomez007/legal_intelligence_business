import { describe, expect, it } from 'vitest';

import type { AuthzContext, IamDeps } from '@legalintel/iam';

import { OrganizationId, UserId } from '@legalintel/kernel';

import {
  createIamRequestAuthResolver,
  type HumanSessionIdentityResolver,
} from '../src/auth/iam-request-auth.js';

const userId = UserId.parse('11111111-1111-4111-8111-111111111111');

const organizationId = OrganizationId.parse('22222222-2222-4222-8222-222222222222');

const context = {
  principal: {
    kind: 'user',

    userId,
  },

  organizationId,

  roles: ['member'],

  permissions: new Set(['ai_task:read']),
} as AuthzContext;

const fakeIam = {} as IamDeps;

function sessions(resolved: UserId | null): HumanSessionIdentityResolver {
  return {
    async resolveBearer() {
      return resolved;
    },
  };
}

describe('Phase 10C2 IAM request authentication', () => {
  it('passes authenticated user identity and requested organization through real IAM context loading boundary', async () => {
    let captured: unknown[] = [];

    const resolver = createIamRequestAuthResolver({
      iam: fakeIam,

      sessions: sessions(userId),

      async loadUserContext(iam, user, organization) {
        captured = [iam, user, organization];

        return context;
      },
    });

    await expect(
      resolver.resolve({
        authorization: 'Bearer signed-session',

        organizationHint: String(organizationId),
      }),
    ).resolves.toBe(context);

    expect(captured).toEqual([fakeIam, userId, organizationId]);
  });

  it('rejects missing bearer credentials before IAM context loading', async () => {
    let called = false;

    const resolver = createIamRequestAuthResolver({
      iam: fakeIam,

      sessions: sessions(userId),

      async loadUserContext() {
        called = true;

        return context;
      },
    });

    await expect(
      resolver.resolve({
        authorization: null,

        organizationHint: String(organizationId),
      }),
    ).resolves.toBeNull();

    expect(called).toBe(false);
  });

  it('rejects malformed organization IDs', async () => {
    const resolver = createIamRequestAuthResolver({
      iam: fakeIam,

      sessions: sessions(userId),

      async loadUserContext() {
        throw new Error('must not execute');
      },
    });

    await expect(
      resolver.resolve({
        authorization: 'Bearer session',

        organizationHint: 'attacker-org',
      }),
    ).resolves.toBeNull();
  });

  it('rejects an invalid human session before IAM context loading', async () => {
    let called = false;

    const resolver = createIamRequestAuthResolver({
      iam: fakeIam,

      sessions: sessions(null),

      async loadUserContext() {
        called = true;

        return context;
      },
    });

    await expect(
      resolver.resolve({
        authorization: 'Bearer invalid',

        organizationHint: String(organizationId),
      }),
    ).resolves.toBeNull();

    expect(called).toBe(false);
  });

  it('maps expected IAM membership refusal to unauthenticated route context', async () => {
    const resolver = createIamRequestAuthResolver({
      iam: fakeIam,

      sessions: sessions(userId),

      async loadUserContext() {
        throw {
          kind: 'not_found',

          code: 'organization.not_found',
        };
      },
    });

    await expect(
      resolver.resolve({
        authorization: 'Bearer session',

        organizationHint: String(organizationId),
      }),
    ).resolves.toBeNull();
  });

  it('does not hide unexpected database/runtime failures as authentication failures', async () => {
    const resolver = createIamRequestAuthResolver({
      iam: fakeIam,

      sessions: sessions(userId),

      async loadUserContext() {
        throw new Error('database unavailable');
      },
    });

    await expect(
      resolver.resolve({
        authorization: 'Bearer session',

        organizationHint: String(organizationId),
      }),
    ).rejects.toThrow('database unavailable');
  });
});
