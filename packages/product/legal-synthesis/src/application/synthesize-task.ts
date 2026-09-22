import type {
  AuthzContext,
} from '@legalintel/iam';

import type {
  GroundedResearchPacket,
} from '@legalintel/legal-retrieval';

import type {
  GroundedLegalSynthesis,
} from '../domain/synthesis.js';

import type {
  LegalSynthesisProvider,
} from '../ports/legal-synthesis-provider.js';

import type {
  TaskAuthorizedResearch,
} from '../ports/task-authorized-research.js';

import {
  synthesizeGroundedLegalResearch,
} from './synthesize.js';

const MAX_QUESTION_BYTES =
  8192;

function fail(
  code: string,
): never {
  throw new Error(
    `legal_synthesis.${code}`,
  );
}

function validateTaskId(
  taskId: string,
): string {
  if (
    typeof taskId !== 'string'
    || taskId.trim() === ''
    || taskId.includes('\0')
  ) {
    fail(
      'task_id_invalid',
    );
  }

  return taskId;
}

function validateQuestion(
  question: string,
): string {
  if (
    typeof question !== 'string'
    || question.includes('\0')
  ) {
    fail(
      'question_invalid',
    );
  }

  const value =
    question.trim();

  if (
    value.length === 0
    || Buffer.byteLength(
      value,
      'utf8',
    ) > MAX_QUESTION_BYTES
  ) {
    fail(
      'question_invalid',
    );
  }

  return value;
}

function validateLimit(
  limit: number | undefined,
): number | undefined {
  if (
    limit === undefined
  ) {
    return undefined;
  }

  if (
    !Number.isSafeInteger(
      limit,
    )
    || limit < 1
    || limit > 50
  ) {
    fail(
      'limit_invalid',
    );
  }

  return limit;
}

function validateResolvedPacket(
  packet:
    GroundedResearchPacket,
  input: {
    readonly context:
      AuthzContext;

    readonly taskId:
      string;

    readonly question:
      string;
  },
): void {
  if (
    packet.scope.countryCode
      !== 'GH'
  ) {
    fail(
      'jurisdiction_not_supported',
    );
  }

  if (
    packet.scope.taskId
      !== input.taskId
  ) {
    fail(
      'task_scope_mismatch',
    );
  }

  if (
    !Number.isSafeInteger(
      packet.scope.taskScopeRevision,
    )
    || packet.scope.taskScopeRevision
      < 1
  ) {
    fail(
      'task_scope_revision_invalid',
    );
  }

  if (
    packet.question.trim()
      !== input.question
  ) {
    fail(
      'research_question_mismatch',
    );
  }

  const contextOrg =
    input.context.organizationId;

  if (
    contextOrg === null
    || contextOrg === undefined
    || String(contextOrg)
      !== packet.scope.organizationId
  ) {
    fail(
      'organization_scope_mismatch',
    );
  }
}

export interface TaskAuthorizedSynthesisDependencies {
  readonly research:
    TaskAuthorizedResearch;

  readonly provider:
    LegalSynthesisProvider;
}

/**
 * Main Phase 9B orchestration boundary.
 *
 * The client/request layer must NOT construct AuthorizedRetrievalScope.
 *
 * Instead:
 *
 * authenticated context
 *   -> task ID
 *   -> trusted task-authorized Phase 8 research
 *   -> grounded packet
 *   -> provider-neutral synthesis
 *
 * The resolved packet is checked again before model execution.
 */
export async function synthesizeAuthorizedTask(
  dependencies:
    TaskAuthorizedSynthesisDependencies,
  input: {
    readonly context:
      AuthzContext;

    readonly taskId:
      string;

    readonly question:
      string;

    readonly limit?:
      number;
  },
): Promise<GroundedLegalSynthesis> {
  const taskId =
    validateTaskId(
      input.taskId,
    );

  const question =
    validateQuestion(
      input.question,
    );

  const limit =
    validateLimit(
      input.limit,
    );

  const packet =
    await dependencies.research
      .research(
        limit === undefined
          ? {
              context:
                input.context,

              taskId,

              question,
            }
          : {
              context:
                input.context,

              taskId,

              question,

              limit,
            },
      );

  validateResolvedPacket(
    packet,
    {
      context:
        input.context,

      taskId,

      question,
    },
  );

  return synthesizeGroundedLegalResearch(
    dependencies.provider,
    packet,
  );
}
