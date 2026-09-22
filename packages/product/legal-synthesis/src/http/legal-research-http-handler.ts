import type { AuthzContext } from '@legalintel/iam';

import type { LegalResearchResult } from '../domain/legal-research-result.js';

import type { LegalResearchWorkspace } from '../application/research-workspace.js';

const MAX_HTTP_BODY_BYTES = 32 * 1024;

const ALLOWED_BODY_KEYS = new Set(['taskId', 'question', 'limit']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResponse(status: number, code: string): LegalResearchHttpResponse {
  return {
    status,

    body: {
      error: {
        code,
      },
    },
  };
}

function mapApplicationError(error: unknown): LegalResearchHttpResponse {
  if (!(error instanceof Error)) {
    return errorResponse(500, 'internal_error');
  }

  const code = error.message;

  if (code.startsWith('legal_research.')) {
    return errorResponse(400, code);
  }

  if (code.startsWith('legal_synthesis.')) {
    if (code === 'legal_synthesis.provider_failed') {
      return errorResponse(503, 'legal_synthesis.provider_unavailable');
    }

    return errorResponse(422, code);
  }

  if (
    code.startsWith('ai_task.') ||
    code.startsWith('authorization.') ||
    code.startsWith('authz.')
  ) {
    return errorResponse(403, 'research_forbidden');
  }

  return errorResponse(500, 'internal_error');
}

export interface LegalResearchHttpRequest {
  /**
   * HTTP method supplied by the server/router.
   */
  readonly method: string;

  /**
   * Parsed JSON request body.
   *
   * Authentication and tenant context are intentionally NOT part of this
   * object. They are passed separately by trusted server middleware.
   */
  readonly body: unknown;

  /**
   * Optional original byte length supplied by the HTTP framework before JSON
   * parsing. If present, this is used for an early body-size rejection.
   */
  readonly bodyByteLength?: number;
}

export interface LegalResearchHttpSuccessBody {
  readonly data: LegalResearchResult;
}

export interface LegalResearchHttpErrorBody {
  readonly error: {
    readonly code: string;
  };
}

export interface LegalResearchHttpResponse {
  readonly status: number;

  readonly body: LegalResearchHttpSuccessBody | LegalResearchHttpErrorBody;
}

export interface HandleLegalResearchHttpRequestDependencies {
  readonly workspace: LegalResearchWorkspace;
}

/**
 * Server HTTP boundary for the legal research workspace.
 *
 * SECURITY BOUNDARY
 * -----------------
 *
 * context MUST come from trusted authentication/authorization middleware.
 * It is deliberately a separate argument and is never read from request.body.
 *
 * Browser/client body may contain ONLY:
 *
 * - taskId
 * - question
 * - limit
 *
 * It may NOT contain:
 *
 * - organizationId
 * - userId
 * - actor
 * - roles
 * - matterId
 * - taskScopeRevision
 * - jurisdiction
 * - countryCode
 * - scopeMode
 * - sources
 * - source IDs
 * - version IDs
 * - passages
 * - evidence
 */
export async function handleLegalResearchHttpRequest(
  dependencies: HandleLegalResearchHttpRequestDependencies,

  context: AuthzContext,

  request: LegalResearchHttpRequest,
): Promise<LegalResearchHttpResponse> {
  if (request.method.toUpperCase() !== 'POST') {
    return errorResponse(405, 'method_not_allowed');
  }

  if (
    request.bodyByteLength !== undefined &&
    (!Number.isSafeInteger(request.bodyByteLength) ||
      request.bodyByteLength < 0 ||
      request.bodyByteLength > MAX_HTTP_BODY_BYTES)
  ) {
    return errorResponse(413, 'request_too_large');
  }

  if (!isRecord(request.body)) {
    return errorResponse(400, 'request_invalid');
  }

  for (const key of Object.keys(request.body)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return errorResponse(400, 'request_field_not_allowed');
    }
  }

  const taskId = request.body['taskId'];

  const question = request.body['question'];

  const limit = request.body['limit'];

  if (typeof taskId !== 'string' || typeof question !== 'string') {
    return errorResponse(400, 'request_invalid');
  }

  if (limit !== undefined && typeof limit !== 'number') {
    return errorResponse(400, 'request_invalid');
  }

  try {
    const result = await dependencies.workspace.run({
      context,

      taskId,

      question,

      ...(limit !== undefined
        ? {
            limit,
          }
        : {}),
    });

    return {
      status: 200,

      body: {
        data: result,
      },
    };
  } catch (error: unknown) {
    /**
     * Never return:
     *
     * - stack traces
     * - raw provider errors
     * - prompts
     * - retrieved evidence
     * - provider response bodies
     * - secrets
     *
     * Only stable application error codes cross this boundary.
     */
    return mapApplicationError(error);
  }
}
