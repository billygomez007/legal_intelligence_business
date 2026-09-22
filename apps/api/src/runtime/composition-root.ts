import type { Server } from 'node:http';

import type { DbPool } from '@legalintel/db';

import {
  createLegalResearchWorkspace,
  createOpenAiLegalSynthesisProviderFromRuntime,
  createPgTaskAuthorizedResearch,
  type LegalSynthesisProvider,
  type LegalSynthesisRuntimeEnvironment,
} from '@legalintel/legal-synthesis';

import {
  createIamRequestAuthResolver,
  type HumanSessionIdentityResolver,
} from '../auth/iam-request-auth.js';

import type { ExternalIdentityVerifier } from '../auth/external-identity.js';

import { createHumanSignInService } from '../auth/sign-in-service.js';

import { createLawAfriqueApiServer } from '../server.js';

import { createLawAfriqueIamRuntime } from './iam-runtime.js';

export interface CreateLawAfriqueApiApplicationDependencies {
  readonly pool: DbPool;

  readonly humanSessions: HumanSessionIdentityResolver;

  readonly externalIdentityVerifier?: ExternalIdentityVerifier;

  readonly authSecret?: string;

  /**
   * Production may create this from the OpenAI runtime configuration.
   *
   * Tests can inject a fake provider so they never touch the network.
   */
  readonly synthesisProvider?: LegalSynthesisProvider;

  readonly synthesisEnvironment?: LegalSynthesisRuntimeEnvironment;
}

export interface LawAfriqueApiApplication {
  readonly server: Server;

  close(): Promise<void>;
}

/**
 * Composition root for the real API application.
 *
 * Request path:
 *
 * HTTP
 * -> trusted human-session verifier
 * -> loadUserContext()
 * -> current DB organization/membership/roles
 * -> authoritative permission catalog
 * -> Phase 10B HTTP boundary
 * -> Phase 10A research workspace
 * -> Phase 9 PostgreSQL task-authorized retrieval
 * -> provider-neutral synthesis
 * -> application-owned citations
 */
export function createLawAfriqueApiApplication(
  dependencies: CreateLawAfriqueApiApplicationDependencies,
): LawAfriqueApiApplication {
  const iam = createLawAfriqueIamRuntime(dependencies.pool);

  const auth = createIamRequestAuthResolver({
    iam,

    sessions: dependencies.humanSessions,
  });

  const research = createPgTaskAuthorizedResearch(dependencies.pool);

  const provider =
    dependencies.synthesisProvider ??
    createOpenAiLegalSynthesisProviderFromRuntime({
      env: dependencies.synthesisEnvironment ?? {},
    });

  const workspace = createLegalResearchWorkspace({
    research,
    provider,
  });

  const signIn =
    dependencies.externalIdentityVerifier !== undefined && dependencies.authSecret !== undefined
      ? createHumanSignInService({
          pool: dependencies.pool,

          verifier: dependencies.externalIdentityVerifier,

          authSecret: dependencies.authSecret,
        })
      : undefined;

  const server = createLawAfriqueApiServer({
    humanSessions: dependencies.humanSessions,

    legalResearch: {
      auth,
      workspace,
    },

    workspaceRoutes: {
      pool: dependencies.pool,
      iam,
      auth,
      humanSessions: dependencies.humanSessions,
    },

    ...(signIn !== undefined
      ? {
          signIn,
        }
      : {}),
  });

  return Object.freeze({
    server,

    async close() {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);

              return;
            }

            resolve();
          });
        });
      }
    },
  });
}
