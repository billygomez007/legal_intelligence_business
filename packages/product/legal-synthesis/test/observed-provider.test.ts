import { describe, expect, it } from 'vitest';

import {
  createObservedLegalSynthesisProvider,
  synthesizeGroundedLegalResearch,
  validateLegalSynthesisProviderMetadata,
  type LegalSynthesisObservation,
  type LegalSynthesisObserver,
  type LegalSynthesisProvider,
  type LegalSynthesisProviderRequest,
} from '../src/index.js';

import type { GroundedResearchPacket } from '@legalintel/legal-retrieval';

const SECRET = 'SECRET_PROVIDER_KEY_MUST_NEVER_APPEAR';

const QUESTION = 'What does Ghanaian law say about equitable estoppel?';

const EXCERPT = 'PRIVATE OR SENSITIVE EVIDENCE EXCERPT';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';

const VERSION_ID = '22222222-2222-4222-8222-222222222222';

const PASSAGE_ID = '33333333-3333-4333-8333-333333333333';

const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444';

const TASK_ID = '55555555-5555-4555-8555-555555555555';

function request(): LegalSynthesisProviderRequest {
  return Object.freeze({
    question: QUESTION,

    countryCode: 'GH',

    evidence: Object.freeze([
      Object.freeze({
        ordinal: 0,

        source: Object.freeze({
          kind: 'corpus_document_version' as const,

          sourceId: SOURCE_ID,

          versionId: VERSION_ID,
        }),

        passageId: PASSAGE_ID,

        locator: 'paragraph:1',

        excerpt: EXCERPT,
      }),
    ]),

    unresolvedIssues: Object.freeze([]),
  });
}

function packet(): GroundedResearchPacket {
  return {
    question: QUESTION,

    scope: {
      organizationId: ORGANIZATION_ID,

      taskId: TASK_ID,

      taskScopeRevision: 1,

      matterId: null,

      countryCode: 'GH',

      scopeMode: 'ghana_corpus',
    },

    evidence: [
      {
        source: {
          kind: 'corpus_document_version',

          sourceId: SOURCE_ID,

          versionId: VERSION_ID,
        },

        passage: {
          passageId: PASSAGE_ID,

          locator: 'paragraph:1',

          contentHash: null,
        },

        score: 1,

        stableKey: 'stable',

        excerpt: EXCERPT,
      },
    ],

    unresolvedIssues: [],

    insufficientEvidence: false,
  } as unknown as GroundedResearchPacket;
}

function successfulProvider(): LegalSynthesisProvider {
  return {
    async synthesize() {
      return {
        summary: 'Grounded answer.',

        propositions: [
          {
            text: 'Grounded proposition.',

            evidenceOrdinals: [0],
          },
        ],

        unresolvedIssues: [],

        insufficientEvidence: false,
      };
    },
  };
}

describe('Phase 9K provider contract and safe observability', () => {
  it('records only allowlisted success metadata', async () => {
    const events: LegalSynthesisObservation[] = [];

    const observer: LegalSynthesisObserver = {
      observe(event) {
        events.push(event);
      },
    };

    const times = [100, 125];

    const provider = createObservedLegalSynthesisProvider({
      provider: successfulProvider(),

      metadata: {
        providerId: 'synthetic-provider',

        modelId: 'synthetic-model-v1',
      },

      observer,

      now: () => times.shift() ?? 125,
    });

    const result = await provider.synthesize(request());

    expect(result.propositions).toHaveLength(1);

    expect(events).toEqual([
      {
        operation: 'legal_synthesis.provider',

        providerId: 'synthetic-provider',

        modelId: 'synthetic-model-v1',

        outcome: 'success',

        durationMs: 25,

        evidenceCount: 1,

        propositionCount: 1,

        unresolvedIssueCount: 0,

        insufficientEvidence: false,

        failureCode: null,
      },
    ]);
  });

  it('does not expose question evidence source tenant or task data in telemetry', async () => {
    const serializedEvents: string[] = [];

    const provider = createObservedLegalSynthesisProvider({
      provider: successfulProvider(),

      metadata: {
        providerId: 'synthetic-provider',

        modelId: 'synthetic-model-v1',
      },

      observer: {
        observe(event) {
          serializedEvents.push(JSON.stringify(event));
        },
      },

      now: (() => {
        let value = 1;

        return () => value++;
      })(),
    });

    await provider.synthesize(request());

    const serialized = serializedEvents.join('\n');

    for (const forbidden of [
      QUESTION,
      EXCERPT,
      SOURCE_ID,
      VERSION_ID,
      PASSAGE_ID,
      ORGANIZATION_ID,
      TASK_ID,
      SECRET,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(serialized).not.toContain('question');

    expect(serialized).not.toContain('excerpt');

    expect(serialized).not.toContain('sourceId');

    expect(serialized).not.toContain('taskId');

    expect(serialized).not.toContain('organizationId');
  });

  it('records only the stable failure classification and never the raw provider error', async () => {
    const events: LegalSynthesisObservation[] = [];

    const rawProvider: LegalSynthesisProvider = {
      async synthesize() {
        throw new Error(`provider exploded ${SECRET} ${EXCERPT}`);
      },
    };

    const provider = createObservedLegalSynthesisProvider({
      provider: rawProvider,

      metadata: {
        providerId: 'synthetic-provider',

        modelId: null,
      },

      observer: {
        observe(event) {
          events.push(event);
        },
      },

      now: (() => {
        const times = [20, 27];

        return () => times.shift() ?? 27;
      })(),
    });

    await expect(provider.synthesize(request())).rejects.toThrow(SECRET);

    expect(events).toEqual([
      {
        operation: 'legal_synthesis.provider',

        providerId: 'synthetic-provider',

        modelId: null,

        outcome: 'failure',

        durationMs: 7,

        evidenceCount: 1,

        propositionCount: null,

        unresolvedIssueCount: null,

        insufficientEvidence: null,

        failureCode: 'provider_failed',
      },
    ]);

    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain(SECRET);

    expect(serialized).not.toContain(EXCERPT);
  });

  it('still lets the Phase 9J application boundary sanitize the raw provider failure', async () => {
    const rawProvider: LegalSynthesisProvider = {
      async synthesize() {
        throw new Error(`raw ${SECRET} ${EXCERPT}`);
      },
    };

    const provider = createObservedLegalSynthesisProvider({
      provider: rawProvider,

      metadata: {
        providerId: 'synthetic-provider',

        modelId: 'synthetic-model-v1',
      },

      observer: {
        observe() {
          // Safe no-op.
        },
      },
    });

    await expect(synthesizeGroundedLegalResearch(provider, packet())).rejects.toThrow(
      'legal_synthesis.provider_failed',
    );
  });

  it('does not let observer failure change a successful provider result', async () => {
    const provider = createObservedLegalSynthesisProvider({
      provider: successfulProvider(),

      metadata: {
        providerId: 'synthetic-provider',

        modelId: 'synthetic-model-v1',
      },

      observer: {
        observe() {
          throw new Error('telemetry unavailable');
        },
      },
    });

    const result = await provider.synthesize(request());

    expect(result.summary).toBe('Grounded answer.');
  });

  it('does not let observer failure replace the original provider error', async () => {
    const rawProvider: LegalSynthesisProvider = {
      async synthesize() {
        throw new Error('original-provider-failure');
      },
    };

    const provider = createObservedLegalSynthesisProvider({
      provider: rawProvider,

      metadata: {
        providerId: 'synthetic-provider',

        modelId: null,
      },

      observer: {
        observe() {
          throw new Error('observer-failure');
        },
      },
    });

    await expect(provider.synthesize(request())).rejects.toThrow('original-provider-failure');
  });

  it('rejects unsafe provider metadata', () => {
    expect(() =>
      validateLegalSynthesisProviderMetadata({
        providerId: 'provider secret=abc',

        modelId: null,
      }),
    ).toThrow('legal_synthesis.provider_id_invalid');

    expect(() =>
      validateLegalSynthesisProviderMetadata({
        providerId: 'safe-provider',

        modelId: 'model token=secret',
      }),
    ).toThrow('legal_synthesis.model_id_invalid');
  });

  it('does not call provider or observer when synthesis has no evidence', async () => {
    let providerCalls = 0;

    let observerCalls = 0;

    const underlying: LegalSynthesisProvider = {
      async synthesize() {
        providerCalls += 1;

        return successfulProvider().synthesize(request());
      },
    };

    const provider = createObservedLegalSynthesisProvider({
      provider: underlying,

      metadata: {
        providerId: 'synthetic-provider',

        modelId: 'synthetic-model-v1',
      },

      observer: {
        observe() {
          observerCalls += 1;
        },
      },
    });

    const empty = {
      ...packet(),

      evidence: [],

      insufficientEvidence: true,
    } as unknown as GroundedResearchPacket;

    const result = await synthesizeGroundedLegalResearch(provider, empty);

    expect(result.insufficientEvidence).toBe(true);

    expect(providerCalls).toBe(0);

    expect(observerCalls).toBe(0);
  });
});
