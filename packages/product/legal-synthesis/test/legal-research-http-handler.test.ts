import { describe, expect, it } from 'vitest';

import type { AuthzContext } from '@legalintel/iam';

import { handleLegalResearchHttpRequest, type LegalResearchWorkspace } from '../src/index.js';

const context = {
  actor: {
    type: 'user',

    userId: '11111111-1111-4111-8111-111111111111',
  },

  organizationId: '22222222-2222-4222-8222-222222222222',

  roles: ['member'],
} as unknown as AuthzContext;

const successResult = {
  question: 'What does the synthetic rule require?',

  summary: 'Synthetic summary.',

  propositions: [
    {
      text: 'Alpha is required.',

      citations: [
        {
          evidenceOrdinal: 0,

          sourceKind: 'corpus_document_version',

          sourceId: '33333333-3333-4333-8333-333333333333',

          versionId: '44444444-4444-4444-8444-444444444444',

          passageId: '55555555-5555-4555-8555-555555555555',

          locator: 'synthetic:1',
        },
      ],
    },
  ],

  unresolvedIssues: [],

  insufficientEvidence: false,

  authoritativeLegalSource: false as const,

  humanReviewRequired: true as const,
};

function workspace(run?: LegalResearchWorkspace['run']): LegalResearchWorkspace {
  return {
    run: run ?? (async () => successResult),
  };
}

describe('Phase 10B legal research HTTP boundary', () => {
  it('accepts POST and passes authenticated server context separately from client body', async () => {
    let captured: unknown = null;

    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(async (request) => {
          captured = request;

          return successResult;
        }),
      },

      context,

      {
        method: 'POST',

        body: {
          taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',

          question: 'What does the synthetic rule require?',

          limit: 10,
        },
      },
    );

    expect(response.status).toBe(200);

    expect(captured).toEqual({
      context,

      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',

      question: 'What does the synthetic rule require?',

      limit: 10,
    });
  });

  it('rejects client-supplied organization scope', async () => {
    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(),
      },

      context,

      {
        method: 'POST',

        body: {
          taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',

          question: 'Question',

          organizationId: 'attacker-org',
        },
      },
    );

    expect(response).toEqual({
      status: 400,

      body: {
        error: {
          code: 'request_field_not_allowed',
        },
      },
    });
  });

  it('rejects client-supplied matter, task revision, sources and evidence', async () => {
    const forbidden = [
      'matterId',
      'taskScopeRevision',
      'sources',
      'evidence',
      'countryCode',
      'scopeMode',
      'actor',
      'roles',
      'userId',
    ];

    for (const field of forbidden) {
      const response = await handleLegalResearchHttpRequest(
        {
          workspace: workspace(),
        },

        context,

        {
          method: 'POST',

          body: {
            taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',

            question: 'Question',

            [field]: 'attacker-value',
          },
        },
      );

      expect(response.status).toBe(400);

      expect(response.body).toEqual({
        error: {
          code: 'request_field_not_allowed',
        },
      });
    }
  });

  it('rejects non-POST methods without calling workspace', async () => {
    let called = false;

    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(async () => {
          called = true;

          return successResult;
        }),
      },

      context,

      {
        method: 'GET',

        body: {},
      },
    );

    expect(response.status).toBe(405);

    expect(called).toBe(false);
  });

  it('rejects invalid request body', async () => {
    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(),
      },

      context,

      {
        method: 'POST',

        body: null,
      },
    );

    expect(response.status).toBe(400);
  });

  it('rejects oversized request before workspace execution', async () => {
    let called = false;

    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(async () => {
          called = true;

          return successResult;
        }),
      },

      context,

      {
        method: 'POST',

        body: {
          taskId: 'task',

          question: 'question',
        },

        bodyByteLength: 32 * 1024 + 1,
      },
    );

    expect(response.status).toBe(413);

    expect(called).toBe(false);
  });

  it('maps provider failures to sanitized service-unavailable response', async () => {
    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(async () => {
          throw new Error('legal_synthesis.provider_failed');
        }),
      },

      context,

      {
        method: 'POST',

        body: {
          taskId: 'task',

          question: 'question',
        },
      },
    );

    expect(response).toEqual({
      status: 503,

      body: {
        error: {
          code: 'legal_synthesis.provider_unavailable',
        },
      },
    });

    expect(JSON.stringify(response)).not.toContain('provider_failed');
  });

  it('never exposes unknown internal error text', async () => {
    const secret = 'SECRET_INTERNAL_DATABASE_MESSAGE';

    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(async () => {
          throw new Error(secret);
        }),
      },

      context,

      {
        method: 'POST',

        body: {
          taskId: 'task',

          question: 'question',
        },
      },
    );

    expect(response).toEqual({
      status: 500,

      body: {
        error: {
          code: 'internal_error',
        },
      },
    });

    expect(JSON.stringify(response)).not.toContain(secret);
  });

  it('preserves non-authoritative and human-review-required trust signals', async () => {
    const response = await handleLegalResearchHttpRequest(
      {
        workspace: workspace(),
      },

      context,

      {
        method: 'POST',

        body: {
          taskId: 'task',

          question: 'question',
        },
      },
    );

    expect(response.status).toBe(200);

    if ('data' in response.body) {
      expect(response.body.data.authoritativeLegalSource).toBe(false);

      expect(response.body.data.humanReviewRequired).toBe(true);
    } else {
      throw new Error('expected_success_response');
    }
  });
});
