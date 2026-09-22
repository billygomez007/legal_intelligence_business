import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HumanSignInService } from '../auth/sign-in-service.js';

import type { HumanSessionIdentityResolver } from '../auth/iam-request-auth.js';

import {
  handleLegalResearchRoute,
  type LegalResearchRouteDependencies,
} from './legal-research-route.js';

import { handleSignInRoute } from './sign-in-route.js';

import { handleSessionValidationRoute } from './session-validation-route.js';

import { sendJson } from './http-utils.js';

import { handleWorkspaceRoute, type WorkspaceRouteDependencies } from './workspace-route.js';

export interface ApiRouterDependencies {
  readonly workspaceRoutes?: WorkspaceRouteDependencies;

  readonly legalResearch: LegalResearchRouteDependencies;

  readonly signIn?: HumanSignInService;

  readonly humanSessions?: HumanSessionIdentityResolver;
}

export async function routeRequest(
  dependencies: ApiRouterDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  const url = new URL(
    request.url ?? '/',

    'http://localhost',
  );

  if (url.pathname === '/health') {
    if (request.method !== 'GET') {
      sendJson(response, 405, {
        error: {
          code: 'method_not_allowed',
        },
      });

      return;
    }

    sendJson(response, 200, {
      status: 'ok',

      service: 'law-afrique-api',
    });

    return;
  }

  if (url.pathname === '/v1/auth/session/validate') {
    if (dependencies.humanSessions === undefined) {
      sendJson(response, 404, {
        error: {
          code: 'route_not_found',
        },
      });

      return;
    }

    await handleSessionValidationRoute(dependencies.humanSessions, request, response);

    return;
  }

  if (url.pathname === '/v1/auth/session') {
    if (dependencies.signIn === undefined) {
      sendJson(response, 404, {
        error: {
          code: 'route_not_found',
        },
      });

      return;
    }

    await handleSignInRoute(dependencies.signIn, request, response);

    return;
  }

  if (
    dependencies.workspaceRoutes !== undefined &&
    (await handleWorkspaceRoute(dependencies.workspaceRoutes, url.pathname, request, response))
  ) {
    return;
  }

  if (url.pathname === '/v1/legal-research') {
    await handleLegalResearchRoute(dependencies.legalResearch, request, response);

    return;
  }

  sendJson(response, 404, {
    error: {
      code: 'route_not_found',
    },
  });
}
