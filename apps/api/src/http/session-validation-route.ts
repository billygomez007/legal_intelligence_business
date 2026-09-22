import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HumanSessionIdentityResolver } from '../auth/iam-request-auth.js';

import { sendJson } from './http-utils.js';

function bearerToken(authorization: string | string[] | undefined): string | null {
  if (typeof authorization !== 'string') {
    return null;
  }

  const prefix = 'Bearer ';

  if (!authorization.startsWith(prefix)) {
    return null;
  }

  const token = authorization.slice(prefix.length);

  if (token.length === 0 || token.trim() !== token) {
    return null;
  }

  return token;
}

export async function handleSessionValidationRoute(
  sessions: HumanSessionIdentityResolver,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: {
        code: 'method_not_allowed',
      },
    });

    return;
  }

  const token = bearerToken(request.headers.authorization);

  if (token === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_failed',
      },
    });

    return;
  }

  const userId = await sessions.resolveBearer(token);

  if (userId === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_failed',
      },
    });

    return;
  }

  /**
   * Deliberately do not return:
   * - userId,
   * - roles,
   * - organizations,
   * - permissions,
   * - token claims.
   *
   * This endpoint proves only that the Law Afrique
   * application session is authentic and unexpired.
   */
  sendJson(response, 200, {
    data: {
      authenticated: true,
    },
  });
}
