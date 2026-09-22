import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  AuthzContext,
} from '@legalintel/iam';

import type {
  GroundedResearchPacket,
  RetrievalEvidence,
} from '@legalintel/legal-retrieval';

import {
  synthesizeAuthorizedTask,
  type LegalSynthesisProvider,
  type TaskAuthorizedResearch,
} from '../src/index.js';

const ORG =
  '00000000-0000-4000-8000-000000000001';

const TASK =
  '00000000-0000-4000-8000-000000000002';

const JURISDICTION =
  '00000000-0000-4000-8000-000000000003';

const USER =
  '00000000-0000-4000-8000-000000000004';

function context():
  AuthzContext {
  return {
    principal: {
      kind:
        'user',

      userId:
        USER as never,
    },

    organizationId:
      ORG as never,

    roles:
      ['member'],

    permissions:
      new Set([
        'ai_task:read',
      ]),
  };
}

function evidence():
  RetrievalEvidence {
  return Object.freeze({
    source:
      Object.freeze({
        kind:
          'corpus_document_version',

        sourceId:
          '10000000-0000-4000-8000-000000000001',

        versionId:
          '10000000-0000-4000-8000-000000000002',
      }),

    passage:
      Object.freeze({
        passageId:
          '10000000-0000-4000-8000-000000000003',

        locator:
          'paragraph:12',

        contentHash:
          'a'.repeat(64),
      }),

    excerpt:
      'Synthetic authorized Ghana legal passage.',

    score:
      1,

    stableKey:
      'synthetic-evidence',
  });
}

function packet(
  overrides: Partial<
    GroundedResearchPacket
  > = {},
):
  GroundedResearchPacket {
  return {
    question:
      'What does the authority establish?',

    scope: {
      organizationId:
        ORG,

      taskId:
        TASK,

      taskScopeRevision:
        4,

      jurisdictionId:
        JURISDICTION,

      countryCode:
        'GH',

      matterId:
        null,

      scopeMode:
        'ghana_corpus',
    },

    evidence: [
      evidence(),
    ],

    unresolvedIssues:
      [],

    insufficientEvidence:
      false,

    ...overrides,
  };
}

function provider():
  LegalSynthesisProvider {
  return {
    synthesize:
      vi.fn(
        async () => ({
          summary:
            'The retrieved authority supports the proposition.',

          propositions: [
            {
              text:
                'The authority supports the proposition.',

              evidenceOrdinals:
                [0],
            },
          ],

          unresolvedIssues:
            [],

          insufficientEvidence:
            false,
        }),
      ),
  };
}

describe(
  'Phase 9B task-authorized synthesis orchestrator',
  () => {
    it(
      'accepts task ID and question without accepting client retrieval scope',
      async () => {
        const research:
          TaskAuthorizedResearch = {
            research:
              vi.fn(
                async (
                  request,
                ) => {
                  expect(
                    Object.keys(
                      request,
                    ).sort(),
                  ).toEqual([
                    'context',
                    'limit',
                    'question',
                    'taskId',
                  ]);

                  expect(
                    request.taskId,
                  ).toBe(
                    TASK,
                  );

                  expect(
                    request.question,
                  ).toBe(
                    'What does the authority establish?',
                  );

                  expect(
                    request.limit,
                  ).toBe(10);

                  return packet();
                },
              ),
          };

        const result =
          await synthesizeAuthorizedTask(
            {
              research,
              provider:
                provider(),
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',

              limit:
                10,
            },
          );

        expect(
          research.research,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.citations,
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      'rejects a packet resolved for a different task before provider execution',
      async () => {
        const model =
          provider();

        const research:
          TaskAuthorizedResearch = {
            async research() {
              return packet({
                scope: {
                  ...packet().scope,

                  taskId:
                    '90000000-0000-4000-8000-000000000001',
                },
              });
            },
          };

        await expect(
          synthesizeAuthorizedTask(
            {
              research,
              provider:
                model,
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',
            },
          ),
        ).rejects.toThrow(
          'legal_synthesis.task_scope_mismatch',
        );

        expect(
          model.synthesize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects a packet resolved for another tenant before provider execution',
      async () => {
        const model =
          provider();

        const research:
          TaskAuthorizedResearch = {
            async research() {
              return packet({
                scope: {
                  ...packet().scope,

                  organizationId:
                    '90000000-0000-4000-8000-000000000002',
                },
              });
            },
          };

        await expect(
          synthesizeAuthorizedTask(
            {
              research,
              provider:
                model,
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',
            },
          ),
        ).rejects.toThrow(
          'legal_synthesis.organization_scope_mismatch',
        );

        expect(
          model.synthesize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects non-Ghana resolved scope before provider execution',
      async () => {
        const model =
          provider();

        const research:
          TaskAuthorizedResearch = {
            async research() {
              return packet({
                scope: {
                  ...packet().scope,

                  countryCode:
                    'NG',
                } as never,
              });
            },
          };

        await expect(
          synthesizeAuthorizedTask(
            {
              research,
              provider:
                model,
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',
            },
          ),
        ).rejects.toThrow(
          'legal_synthesis.jurisdiction_not_supported',
        );

        expect(
          model.synthesize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects a stale or malformed task scope revision before provider execution',
      async () => {
        const model =
          provider();

        const research:
          TaskAuthorizedResearch = {
            async research() {
              return packet({
                scope: {
                  ...packet().scope,

                  taskScopeRevision:
                    0,
                },
              });
            },
          };

        await expect(
          synthesizeAuthorizedTask(
            {
              research,
              provider:
                model,
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',
            },
          ),
        ).rejects.toThrow(
          'legal_synthesis.task_scope_revision_invalid',
        );

        expect(
          model.synthesize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects a research packet for a different question',
      async () => {
        const model =
          provider();

        const research:
          TaskAuthorizedResearch = {
            async research() {
              return packet({
                question:
                  'Different question',
              });
            },
          };

        await expect(
          synthesizeAuthorizedTask(
            {
              research,
              provider:
                model,
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',
            },
          ),
        ).rejects.toThrow(
          'legal_synthesis.research_question_mismatch',
        );

        expect(
          model.synthesize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'does not call the synthesis provider when authorized research returns no evidence',
      async () => {
        const model =
          provider();

        const research:
          TaskAuthorizedResearch = {
            async research() {
              return packet({
                evidence:
                  [],

                insufficientEvidence:
                  true,
              });
            },
          };

        const result =
          await synthesizeAuthorizedTask(
            {
              research,
              provider:
                model,
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',
            },
          );

        expect(
          model.synthesize,
        ).not.toHaveBeenCalled();

        expect(
          result.insufficientEvidence,
        ).toBe(true);
      },
    );

    it(
      'validates the requested limit before authorized research',
      async () => {
        const research:
          TaskAuthorizedResearch = {
            research:
              vi.fn(),
          };

        await expect(
          synthesizeAuthorizedTask(
            {
              research,
              provider:
                provider(),
            },
            {
              context:
                context(),

              taskId:
                TASK,

              question:
                'What does the authority establish?',

              limit:
                51,
            },
          ),
        ).rejects.toThrow(
          'legal_synthesis.limit_invalid',
        );

        expect(
          research.research,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
