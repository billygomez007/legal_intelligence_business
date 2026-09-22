import { describe, expect, it } from 'vitest';

import type { GroundedResearchPacket } from '@legalintel/legal-retrieval';

import {
  createOpenAiLegalSynthesisProviderFromRuntime,
  isOpenAiLiveAcceptanceEnabled,
  synthesizeGroundedLegalResearch,
} from '../src/index.js';

const env = process.env;

const liveEnabled = isOpenAiLiveAcceptanceEnabled(env);

/**
 * LIVE PROVIDER ACCEPTANCE
 *
 * This suite NEVER runs merely because OPENAI_API_KEY exists.
 *
 * It requires BOTH:
 *
 *   LEGAL_SYNTHESIS_PROVIDER=openai
 *   LIVE_OPENAI_ACCEPTANCE=1
 *
 * The fixture below is synthetic and contains no tenant/client/matter data.
 */
describe.runIf(liveEnabled)('Phase 9N live OpenAI synthetic acceptance', () => {
  it('returns grounded synthesis from synthetic evidence with application-owned citation identity', async () => {
    const packet = {
      question: 'According only to the supplied synthetic rule, what three elements are required?',

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

          stableKey: 'phase9n-synthetic',

          excerpt: [
            'Synthetic acceptance fixture only.',
            'The synthetic rule requires exactly three elements:',
            'Alpha, Beta, and Gamma.',
            'This text is not actual Ghanaian law.',
          ].join(' '),
        },
      ],

      unresolvedIssues: [],

      insufficientEvidence: false,
    } as unknown as GroundedResearchPacket;

    const provider = createOpenAiLegalSynthesisProviderFromRuntime({
      env,
    });

    const result = await synthesizeGroundedLegalResearch(provider, packet);

    expect(result.insufficientEvidence).toBe(false);

    expect(result.propositions.length).toBeGreaterThan(0);

    expect(result.citations).toEqual([
      {
        evidenceOrdinal: 0,

        sourceKind: 'corpus_document_version',

        sourceId: '11111111-1111-4111-8111-111111111111',

        versionId: '22222222-2222-4222-8222-222222222222',

        passageId: '33333333-3333-4333-8333-333333333333',

        locator: 'synthetic:paragraph:1',
      },
    ]);
  });
});
