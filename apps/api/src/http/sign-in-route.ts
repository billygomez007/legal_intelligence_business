import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HumanSignInService } from '../auth/sign-in-service.js';

import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
  sendJson,
} from './http-utils.js';

const ALLOWED_FIELDS = new Set(['provider', 'credential']);

function exactRequest(value: unknown): {
  readonly provider: string;

  readonly credential: string;
} | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return null;
    }
  }

  if (
    Object.keys(record).length !== 2 ||
    typeof record['provider'] !== 'string' ||
    typeof record['credential'] !== 'string'
  ) {
    return null;
  }

  return {
    provider: record['provider'],

    credential: record['credential'],
  };
}

export async function handleSignInRoute(
  service: HumanSignInService,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: {
        code: 'method_not_allowed',
      },
    });

    return;
  }

  try {
    const { body } = await readJsonBody(request);

    const parsed = exactRequest(body);

    if (parsed === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const result = await service.signIn(parsed);

    if (result === null) {
      /**
       * Do not reveal:
       * - whether an identity exists,
       * - whether a provider subject exists,
       * - why provider verification failed.
       */
      sendJson(response, 401, {
        error: {
          code: 'authentication_failed',
        },
      });

      return;
    }

    sendJson(response, 200, {
      data: {
        sessionToken: result.sessionToken,

        tokenType: 'Bearer',

        expiresInSeconds: result.expiresInSeconds,
      },
    });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      sendJson(response, 413, {
        error: {
          code: 'request_too_large',
        },
      });

      return;
    }

    if (error instanceof InvalidJsonBodyError) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    sendJson(response, 500, {
      error: {
        code: 'internal_error',
      },
    });
  }
}
