import type { AuthzContext } from '@legalintel/iam';

import type { LegalResearchResult } from '../domain/legal-research-result.js';

import type { LegalSynthesisProvider } from '../ports/legal-synthesis-provider.js';

import type { TaskAuthorizedResearch } from '../ports/task-authorized-research.js';

import { synthesizeAuthorizedTask } from './synthesize-task.js';

const MAX_TASK_ID_BYTES = 512;

const MAX_QUESTION_BYTES = 16 * 1024;

function fail(code: string): never {
  throw new Error(`legal_research.${code}`);
}

function boundedText(value: string, maxBytes: number, code: string): string {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

  if (normalized.length === 0) {
    fail(`${code}_required`);
  }

  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    fail(`${code}_too_large`);
  }

  if (normalized.includes('\0')) {
    fail(`${code}_invalid`);
  }

  return normalized;
}

export interface RunLegalResearchRequest {
  /**
   * Server-authenticated authorization context.
   *
   * Organization/matter/scope information MUST NOT be supplied separately by
   * the browser/client.
   */
  readonly context: AuthzContext;

  /**
   * Existing server-owned AI Task identity.
   */
  readonly taskId: string;

  /**
   * User's original legal research question.
   */
  readonly question: string;

  readonly limit?: number;
}

export interface LegalResearchWorkspace {
  run(request: RunLegalResearchRequest): Promise<LegalResearchResult>;
}

export interface CreateLegalResearchWorkspaceDependencies {
  readonly research: TaskAuthorizedResearch;

  readonly provider: LegalSynthesisProvider;
}

/**
 * Creates the user-facing research application service.
 *
 * The service intentionally accepts no organizationId, matterId,
 * jurisdiction, scope revision, source kinds or source identities.
 *
 * Those values remain server-owned and are derived from the current AI Task.
 */
export function createLegalResearchWorkspace(
  dependencies: CreateLegalResearchWorkspaceDependencies,
): LegalResearchWorkspace {
  return Object.freeze({
    async run(request: RunLegalResearchRequest): Promise<LegalResearchResult> {
      const taskId = boundedText(request.taskId, MAX_TASK_ID_BYTES, 'task_id');

      const question = boundedText(request.question, MAX_QUESTION_BYTES, 'question');

      if (
        request.limit !== undefined &&
        (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50)
      ) {
        fail('limit_invalid');
      }

      const synthesis = await synthesizeAuthorizedTask(
        {
          research: dependencies.research,

          provider: dependencies.provider,
        },
        {
          context: request.context,

          taskId,

          question,

          ...(request.limit !== undefined
            ? {
                limit: request.limit,
              }
            : {}),
        },
      );

      return Object.freeze({
        question: synthesis.question,

        summary: synthesis.summary,

        propositions: Object.freeze(
          synthesis.propositions.map((proposition) =>
            Object.freeze({
              text: proposition.text,

              citations: Object.freeze(
                proposition.citations.map((citation) =>
                  Object.freeze({
                    evidenceOrdinal: citation.evidenceOrdinal,

                    sourceKind: citation.sourceKind,

                    sourceId: citation.sourceId,

                    versionId: citation.versionId,

                    passageId: citation.passageId,

                    locator: citation.locator,
                  }),
                ),
              ),
            }),
          ),
        ),

        unresolvedIssues: Object.freeze([...synthesis.unresolvedIssues]),

        insufficientEvidence: synthesis.insufficientEvidence,

        authoritativeLegalSource: false,

        humanReviewRequired: true,
      });
    },
  });
}
