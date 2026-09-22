import { describe, expect, it } from 'vitest';

import type { GroundedResearchPacket } from '@legalintel/legal-retrieval';

import {
  createTransportLegalSynthesisProvider,
  synthesizeGroundedLegalResearch,
  type LegalSynthesisTransport,
} from '../src/index.js';

const packet = {
  question: 'What does Ghanaian law say about equitable estoppel?',

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

        locator: 'paragraph:1',

        contentHash: null,
      },

      score: 1,

      stableKey: 'stable',

      excerpt: 'Representation reliance prejudice.',
    },
  ],

  unresolvedIssues: [],

  insufficientEvidence: false,
} as unknown as GroundedResearchPacket;

describe('Phase 9L transport provider application integration', () => {
  it('preserves application-owned citation identity through the transport adapter', async () => {
    const transport: LegalSynthesisTransport = {
      async execute() {
        return JSON.stringify({
          schemaVersion: 1,

          summary: 'Grounded answer.',

          propositions: [
            {
              text: 'Grounded proposition.',

              evidenceOrdinals: [0],
            },
          ],

          unresolvedIssues: [],

          insufficientEvidence: false,
        });
      },
    };

    const provider = createTransportLegalSynthesisProvider({
      transport,
    });

    const result = await synthesizeGroundedLegalResearch(provider, packet);

    expect(result.citations).toEqual([
      {
        evidenceOrdinal: 0,

        sourceKind: 'corpus_document_version',

        sourceId: '11111111-1111-4111-8111-111111111111',

        versionId: '22222222-2222-4222-8222-222222222222',

        passageId: '33333333-3333-4333-8333-333333333333',

        locator: 'paragraph:1',
      },
    ]);
  });

  it('lets the application sanitize transport failures', async () => {
    const transport: LegalSynthesisTransport = {
      async execute() {
        throw new Error('provider-secret transport failure');
      },
    };

    const provider = createTransportLegalSynthesisProvider({
      transport,
    });

    await expect(synthesizeGroundedLegalResearch(provider, packet)).rejects.toThrow(
      'legal_synthesis.provider_failed',
    );
  });

  it('rejects model-invented citation fields before application mapping', async () => {
    const transport: LegalSynthesisTransport = {
      async execute() {
        return JSON.stringify({
          schemaVersion: 1,

          summary: 'Attempted response.',

          propositions: [
            {
              text: 'Attempted proposition.',

              evidenceOrdinals: [0],

              citation: 'Invented Case v Fake Authority',
            },
          ],

          unresolvedIssues: [],

          insufficientEvidence: false,
        });
      },
    };

    const provider = createTransportLegalSynthesisProvider({
      transport,
    });

    await expect(synthesizeGroundedLegalResearch(provider, packet)).rejects.toThrow(
      'legal_synthesis.provider_failed',
    );
  });
});
