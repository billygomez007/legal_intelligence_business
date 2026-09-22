import { describe, expect, it } from 'vitest';

import type { GroundedResearchPacket } from '@legalintel/legal-retrieval';

import { synthesizeGroundedLegalResearch, type LegalSynthesisProvider } from '../src/index.js';

const packet = {
  question: 'What does the synthetic rule require?',

  scope: {
    organizationId: '44444444-4444-4444-8444-444444444444',

    taskId: '55555555-5555-4555-8555-555555555555',

    taskScopeRevision: 1,

    matterId: null,

    countryCode: 'GH',

    scopeMode: 'ghana_corpus',
  },

  evidence: [
    {
      source: {
        kind: 'corpus_document_version',

        sourceId: '11111111-1111-4111-8111-111111111111',

        versionId: '22222222-2222-4222-8222-222222222222',
      },

      passage: {
        passageId: '33333333-3333-4333-8333-333333333333',

        locator: 'synthetic:paragraph:1',

        contentHash: null,
      },

      score: 1,

      stableKey: 'phase9p-runtime-boundary',

      excerpt: 'Synthetic rule requires Alpha, Beta and Gamma.',
    },
  ],

  unresolvedIssues: [],

  insufficientEvidence: false,
} as unknown as GroundedResearchPacket;

function malformedProvider(value: unknown): LegalSynthesisProvider {
  return {
    async synthesize() {
      return value as never;
    },
  };
}

async function expectInvalid(value: unknown): Promise<void> {
  await expect(synthesizeGroundedLegalResearch(malformedProvider(value), packet)).rejects.toThrow(
    'legal_synthesis.provider_result_invalid',
  );
}

describe('Phase 9P provider runtime boundary', () => {
  it('rejects null provider result with stable domain error', async () => {
    await expectInvalid(null);
  });

  it('rejects array provider result with stable domain error', async () => {
    await expectInvalid([]);
  });

  it('rejects non-string summary before string operations', async () => {
    await expectInvalid({
      summary: 123,

      propositions: [],

      unresolvedIssues: [],

      insufficientEvidence: true,
    });
  });

  it('rejects non-array propositions', async () => {
    await expectInvalid({
      summary: 'summary',

      propositions: null,

      unresolvedIssues: [],

      insufficientEvidence: true,
    });
  });

  it('rejects null proposition entry before property access', async () => {
    await expectInvalid({
      summary: 'summary',

      propositions: [null],

      unresolvedIssues: [],

      insufficientEvidence: false,
    });
  });

  it('rejects proposition with non-string text', async () => {
    await expectInvalid({
      summary: 'summary',

      propositions: [
        {
          text: 123,

          evidenceOrdinals: [0],
        },
      ],

      unresolvedIssues: [],

      insufficientEvidence: false,
    });
  });

  it('rejects proposition with malformed evidence ordinals', async () => {
    await expectInvalid({
      summary: 'summary',

      propositions: [
        {
          text: 'proposition',

          evidenceOrdinals: ['0'],
        },
      ],

      unresolvedIssues: [],

      insufficientEvidence: false,
    });
  });

  it('rejects non-array unresolved issues', async () => {
    await expectInvalid({
      summary: 'summary',

      propositions: [],

      unresolvedIssues: 'none',

      insufficientEvidence: true,
    });
  });

  it('rejects non-boolean insufficientEvidence', async () => {
    await expectInvalid({
      summary: 'summary',

      propositions: [],

      unresolvedIssues: [],

      insufficientEvidence: 'false',
    });
  });
});
