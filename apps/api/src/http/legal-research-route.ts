import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleLegalResearchHttpRequest,
  type LegalResearchWorkspace,
} from '@legalintel/legal-synthesis';

import type { RequestAuthResolver } from '../auth/request-auth.js';

import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
  sendJson,
} from './http-utils.js';

export interface LegalResearchRouteDependencies {
  readonly auth: RequestAuthResolver;

  readonly workspace: LegalResearchWorkspace;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && value.length === 1) {
    return value[0] ?? null;
  }

  return null;
}

export async function handleLegalResearchRoute(
  dependencies: LegalResearchRouteDependencies,

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

  const context = await dependencies.auth.resolve({
    authorization: headerValue(request.headers['authorization']),

    /**
     * This is only a lookup hint.
     *
     * The IAM resolver MUST independently verify active membership before
     * returning an AuthzContext.
     *
     * The value is never itself trusted as tenant authorization.
     */
    organizationHint: headerValue(request.headers['x-organization-id']),
  });

  if (context === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  try {
    const { body, byteLength } = await readJsonBody(request);

    const result = await handleLegalResearchHttpRequest(
      {
        workspace: dependencies.workspace,
      },

      context,

      {
        method: 'POST',

        body,

        bodyByteLength: byteLength,
      },
    );

    sendJson(response, result.status, result.body);
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

    /**
     * Never expose unexpected parser/server errors.
     */
    sendJson(response, 500, {
      error: {
        code: 'internal_error',
      },
    });
  }
}
