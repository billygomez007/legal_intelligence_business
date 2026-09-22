import { describe, expect, it } from 'vitest';

import type { AuthzContext } from '@legalintel/iam';

import type { GroundedResearchPacket } from '@legalintel/legal-retrieval';

import {
  createLegalResearchWorkspace,
  type LegalSynthesisProvider,
  type TaskAuthorizedResearch,
} from '../src/index.js';

const context = {
  actor: {
    type: 'user',

    userId: '11111111-1111-4111-8111-111111111111',
  },

  organizationId: '22222222-2222-4222-8222-222222222222',

  roles: ['member'],
} as unknown as AuthzContext;

const packet = {
  question: 'What does the synthetic rule require?',

  scope: {
    organizationId: '22222222-2222-4222-8222-222222222222',

    taskId: '33333333-3333-4333-8333-333333333333',

    taskScopeRevision: 4,

    matterId: null,

    countryCode: 'GH',

    scopeMode: 'ghana_corpus',
  },

  evidence: [
    {
      source: {
        kind: 'corpus_document_version',

        sourceId: '44444444-4444-4444-8444-444444444444',

        versionId: '55555555-5555-4555-8555-555555555555',
      },

      passage: {
        passageId: '66666666-6666-4666-8666-666666666666',

        locator: 'synthetic:paragraph:1',

        contentHash: null,
      },

      score: 1,

      stableKey: 'phase10a-synthetic',

      excerpt: 'The synthetic rule requires Alpha, Beta and Gamma.',
    },
  ],

  unresolvedIssues: [],

  insufficientEvidence: false,
} as unknown as GroundedResearchPacket;

function createResearch(override?: Partial<TaskAuthorizedResearch>): TaskAuthorizedResearch {
  return {
    async research(request) {
      return {
        ...packet,

        question: request.question,
      };
    },

    ...override,
  };
}

function createProvider(): LegalSynthesisProvider {
  return {
    async synthesize() {
      return {
        summary: 'The supplied synthetic rule contains three elements.',

        propositions: [
          {
            text: 'The required elements are Alpha, Beta and Gamma.',

            evidenceOrdinals: [0],
          },
        ],

        unresolvedIssues: [],

        insufficientEvidence: false,
      };
    },
  };
}

describe('Phase 10A legal research workspace', () => {
  it('returns user-facing grounded research with application-owned citations', async () => {
    const workspace = createLegalResearchWorkspace({
      research: createResearch(),

      provider: createProvider(),
    });

    const result = await workspace.run({
      context,

      taskId: '33333333-3333-4333-8333-333333333333',

      question: 'What does the synthetic rule require?',
    });

    expect(result.question).toBe('What does the synthetic rule require?');

    expect(result.propositions).toEqual([
      {
        text: 'The required elements are Alpha, Beta and Gamma.',

        citations: [
          {
            evidenceOrdinal: 0,

            sourceKind: 'corpus_document_version',

            sourceId: '44444444-4444-4444-8444-444444444444',

            versionId: '55555555-5555-4555-8555-555555555555',

            passageId: '66666666-6666-4666-8666-666666666666',

            locator: 'synthetic:paragraph:1',
          },
        ],
      },
    ]);

    expect(result.authoritativeLegalSource).toBe(false);

    expect(result.humanReviewRequired).toBe(true);
  });

  it('does not expose client-controlled scope fields in the request contract', async () => {
    let received: unknown = null;

    const research = createResearch({
      async research(request) {
        received = request;

        return {
          ...packet,

          question: request.question,
        };
      },
    });

    const workspace = createLegalResearchWorkspace({
      research,

      provider: createProvider(),
    });

    await workspace.run({
      context,

      taskId: '33333333-3333-4333-8333-333333333333',

      question: 'What does the synthetic rule require?',
    });

    expect(received).toEqual({
      context,

      taskId: '33333333-3333-4333-8333-333333333333',

      question: 'What does the synthetic rule require?',
    });

    expect(received).not.toHaveProperty('organizationId');

    expect(received).not.toHaveProperty('matterId');

    expect(received).not.toHaveProperty('taskScopeRevision');

    expect(received).not.toHaveProperty('sources');
  });

  it('normalizes the question without changing its meaning', async () => {
    let receivedQuestion = '';

    const research = createResearch({
      async research(request) {
        receivedQuestion = request.question;

        return {
          ...packet,

          question: request.question,
        };
      },
    });

    const workspace = createLegalResearchWorkspace({
      research,

      provider: createProvider(),
    });

    await workspace.run({
      context,

      taskId: '33333333-3333-4333-8333-333333333333',

      question: '   What   does   the synthetic rule require?   ',
    });

    expect(receivedQuestion).toBe('What does the synthetic rule require?');
  });

  it('rejects an empty question before research', async () => {
    let called = false;

    const workspace = createLegalResearchWorkspace({
      research: createResearch({
        async research() {
          called = true;

          return packet;
        },
      }),

      provider: createProvider(),
    });

    await expect(
      workspace.run({
        context,

        taskId: '33333333-3333-4333-8333-333333333333',

        question: '   ',
      }),
    ).rejects.toThrow('legal_research.question_required');

    expect(called).toBe(false);
  });

  it('rejects an invalid retrieval limit', async () => {
    const workspace = createLegalResearchWorkspace({
      research: createResearch(),

      provider: createProvider(),
    });

    await expect(
      workspace.run({
        context,

        taskId: '33333333-3333-4333-8333-333333333333',

        question: 'Question',

        limit: 51,
      }),
    ).rejects.toThrow('legal_research.limit_invalid');
  });

  it('preserves insufficient-evidence behavior', async () => {
    let providerCalled = false;

    const research: TaskAuthorizedResearch = {
      async research(request) {
        return {
          ...packet,

          question: request.question,

          evidence: [],

          insufficientEvidence: true,
        };
      },
    };

    const provider: LegalSynthesisProvider = {
      async synthesize() {
        providerCalled = true;

        return {
          summary: 'must not run',

          propositions: [],

          unresolvedIssues: [],

          insufficientEvidence: false,
        };
      },
    };

    const workspace = createLegalResearchWorkspace({
      research,

      provider,
    });

    const result = await workspace.run({
      context,

      taskId: '33333333-3333-4333-8333-333333333333',

      question: 'Unsupported question',
    });

    expect(providerCalled).toBe(false);

    expect(result.insufficientEvidence).toBe(true);

    expect(result.propositions).toEqual([]);
  });
});
