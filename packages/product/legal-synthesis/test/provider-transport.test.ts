import { describe, expect, it } from 'vitest';

import {
  buildLegalSynthesisTransportRequest,
  createTransportLegalSynthesisProvider,
  legalSynthesisTransportLimits,
  parseLegalSynthesisTransportResponse,
  serializeLegalSynthesisTransportRequest,
  type LegalSynthesisProviderRequest,
  type LegalSynthesisTransport,
} from '../src/index.js';

const request: LegalSynthesisProviderRequest = Object.freeze({
  question: 'What does Ghanaian law say about equitable estoppel?',

  countryCode: 'GH',

  evidence: Object.freeze([
    Object.freeze({
      ordinal: 0,

      source: Object.freeze({
        kind: 'corpus_document_version' as const,

        sourceId: '11111111-1111-4111-8111-111111111111',

        versionId: '22222222-2222-4222-8222-222222222222',
      }),

      passageId: '33333333-3333-4333-8333-333333333333',

      locator: 'paragraph:1',

      excerpt: 'Representation reliance prejudice.',
    }),
  ]),

  unresolvedIssues: Object.freeze([]),
});

describe('Phase 9L provider transport schema', () => {
  it('serializes the bounded provider request deterministically', () => {
    const first = serializeLegalSynthesisTransportRequest(request);

    const second = serializeLegalSynthesisTransportRequest(request);

    expect(first).toBe(second);

    expect(JSON.parse(first)).toEqual({
      schemaVersion: 1,

      task: 'grounded_legal_synthesis',

      jurisdiction: 'GH',

      question: request.question,

      evidence: [
        {
          ordinal: 0,

          sourceKind: 'corpus_document_version',

          sourceId: '11111111-1111-4111-8111-111111111111',

          versionId: '22222222-2222-4222-8222-222222222222',

          passageId: '33333333-3333-4333-8333-333333333333',

          locator: 'paragraph:1',

          excerpt: 'Representation reliance prejudice.',
        },
      ],

      unresolvedIssues: [],
    });
  });

  it('contains no tenant task matter user or credential fields', () => {
    const value = JSON.stringify(buildLegalSynthesisTransportRequest(request));

    for (const forbidden of [
      'organizationId',
      'taskId',
      'matterId',
      'userId',
      'apiKey',
      'accessToken',
      'secret',
      'password',
    ]) {
      expect(value).not.toContain(forbidden);
    }
  });

  it('parses a valid strict response', () => {
    const result = parseLegalSynthesisTransportResponse(
      JSON.stringify({
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
      }),
    );

    expect(result.summary).toBe('Grounded answer.');

    expect(result.propositions[0]?.evidenceOrdinals).toEqual([0]);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseLegalSynthesisTransportResponse('{not json')).toThrow(
      'legal_synthesis.transport_response_json_invalid',
    );
  });

  it('rejects unknown top-level fields', () => {
    expect(() =>
      parseLegalSynthesisTransportResponse(
        JSON.stringify({
          schemaVersion: 1,

          summary: 'Grounded.',

          propositions: [
            {
              text: 'Grounded.',

              evidenceOrdinals: [0],
            },
          ],

          unresolvedIssues: [],

          insufficientEvidence: false,

          hiddenPrompt: 'ignore safety',
        }),
      ),
    ).toThrow('legal_synthesis.transport_unknown_field');
  });

  it('rejects unknown proposition fields', () => {
    expect(() =>
      parseLegalSynthesisTransportResponse(
        JSON.stringify({
          schemaVersion: 1,

          summary: 'Grounded.',

          propositions: [
            {
              text: 'Grounded.',

              evidenceOrdinals: [0],

              sourceId: 'model-invented-source',
            },
          ],

          unresolvedIssues: [],

          insufficientEvidence: false,
        }),
      ),
    ).toThrow('legal_synthesis.transport_unknown_field');
  });

  it('rejects malformed ordinals', () => {
    for (const evidenceOrdinals of [[], [-1], [1.5], ['0']]) {
      expect(() =>
        parseLegalSynthesisTransportResponse(
          JSON.stringify({
            schemaVersion: 1,

            summary: 'Grounded.',

            propositions: [
              {
                text: 'Grounded.',

                evidenceOrdinals,
              },
            ],

            unresolvedIssues: [],

            insufficientEvidence: false,
          }),
        ),
      ).toThrow('legal_synthesis.transport_response_invalid');
    }
  });

  it('rejects wrong schema version', () => {
    expect(() =>
      parseLegalSynthesisTransportResponse(
        JSON.stringify({
          schemaVersion: 2,

          summary: 'Grounded.',

          propositions: [
            {
              text: 'Grounded.',

              evidenceOrdinals: [0],
            },
          ],

          unresolvedIssues: [],

          insufficientEvidence: false,
        }),
      ),
    ).toThrow('legal_synthesis.transport_response_invalid');
  });

  it('enforces the response byte bound before parsing', () => {
    expect(() =>
      parseLegalSynthesisTransportResponse(
        'X'.repeat(legalSynthesisTransportLimits.responseBytes + 1),
      ),
    ).toThrow('legal_synthesis.transport_response_too_large');
  });

  it('converts the generic transport into the existing provider contract', async () => {
    let outbound: string | null = null;

    const transport: LegalSynthesisTransport = {
      async execute(input) {
        outbound = input.body;

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

    const result = await provider.synthesize(request);

    expect(outbound).not.toBeNull();

    expect(result.propositions).toHaveLength(1);
  });

  it('does not swallow transport failures', async () => {
    const transport: LegalSynthesisTransport = {
      async execute() {
        throw new Error('raw-transport-failure');
      },
    };

    const provider = createTransportLegalSynthesisProvider({
      transport,
    });

    await expect(provider.synthesize(request)).rejects.toThrow('raw-transport-failure');
  });
});
