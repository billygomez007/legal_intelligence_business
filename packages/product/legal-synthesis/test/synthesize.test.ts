import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  GroundedResearchPacket,
  RetrievalEvidence,
} from '@legalintel/legal-retrieval';

import {
  synthesizeGroundedLegalResearch,
  type LegalSynthesisProvider,
} from '../src/index.js';

function evidence(
  input: {
    readonly sourceId:
      string;
    readonly versionId:
      string;
    readonly passageId:
      string;
    readonly locator:
      string;
    readonly excerpt:
      string;
  },
): RetrievalEvidence {
  return Object.freeze({
    source:
      Object.freeze({
        kind:
          'corpus_document_version',
        sourceId:
          input.sourceId,
        versionId:
          input.versionId,
      }),

    passage:
      Object.freeze({
        passageId:
          input.passageId,
        locator:
          input.locator,
        contentHash:
          'a'.repeat(64),
      }),

    excerpt:
      input.excerpt,

    score:
      1,

    stableKey:
      [
        input.sourceId,
        input.versionId,
        input.passageId,
      ].join(':'),
  });
}

function packet(
  items:
    readonly RetrievalEvidence[],
): GroundedResearchPacket {
  return Object.freeze({
    question:
      'What does the Ghanaian authority establish?',

    scope:
      Object.freeze({
        organizationId:
          '00000000-0000-4000-8000-000000000001',

        taskId:
          '00000000-0000-4000-8000-000000000002',

        taskScopeRevision:
          1,

        jurisdictionId:
          '00000000-0000-4000-8000-000000000003',

        countryCode:
          'GH',

        matterId:
          null,

        scopeMode:
          'ghana_corpus',
      }),

    evidence:
      Object.freeze([
        ...items,
      ]),

    unresolvedIssues:
      Object.freeze([]),

    insufficientEvidence:
      items.length === 0,
  });
}

describe(
  'Phase 9A grounded legal synthesis',
  () => {
    it(
      'does not call a model provider when retrieval produced no evidence',
      async () => {
        const provider:
          LegalSynthesisProvider = {
            synthesize:
              vi.fn(),
          };

        const result =
          await synthesizeGroundedLegalResearch(
            provider,
            packet([]),
          );

        expect(
          provider.synthesize,
        ).not.toHaveBeenCalled();

        expect(
          result.insufficientEvidence,
        ).toBe(true);

        expect(
          result.citations,
        ).toEqual([]);

        expect(
          result.propositions,
        ).toEqual([]);
      },
    );

    it(
      'constructs exact citations from authorized evidence instead of provider supplied IDs',
      async () => {
        const e0 =
          evidence({
            sourceId:
              '10000000-0000-4000-8000-000000000001',
            versionId:
              '10000000-0000-4000-8000-000000000002',
            passageId:
              '10000000-0000-4000-8000-000000000003',
            locator:
              'paragraph:12',
            excerpt:
              'Authorized Ghana authority passage.',
          });

        const provider:
          LegalSynthesisProvider = {
            async synthesize(
              request,
            ) {
              expect(
                request.evidence,
              ).toHaveLength(1);

              return {
                summary:
                  'The retrieved authority supports the proposition.',

                propositions: [
                  {
                    text:
                      'The authority supports the stated proposition.',

                    evidenceOrdinals:
                      [0],
                  },
                ],

                unresolvedIssues:
                  [],

                insufficientEvidence:
                  false,
              };
            },
          };

        const result =
          await synthesizeGroundedLegalResearch(
            provider,
            packet([
              e0,
            ]),
          );

        expect(
          result.citations,
        ).toEqual([
          {
            evidenceOrdinal:
              0,

            sourceKind:
              'corpus_document_version',

            sourceId:
              e0.source.sourceId,

            versionId:
              e0.source.versionId,

            passageId:
              e0.passage
                ?.passageId,

            locator:
              e0.passage
                ?.locator,
          },
        ]);
      },
    );

    it(
      'rejects a provider citation to evidence that was never retrieved',
      async () => {
        const provider:
          LegalSynthesisProvider = {
            async synthesize() {
              return {
                summary:
                  'Unsupported.',

                propositions: [
                  {
                    text:
                      'Unsupported proposition.',

                    evidenceOrdinals:
                      [99],
                  },
                ],

                unresolvedIssues:
                  [],

                insufficientEvidence:
                  false,
              };
            },
          };

        await expect(
          synthesizeGroundedLegalResearch(
            provider,
            packet([
              evidence({
                sourceId:
                  '20000000-0000-4000-8000-000000000001',
                versionId:
                  '20000000-0000-4000-8000-000000000002',
                passageId:
                  '20000000-0000-4000-8000-000000000003',
                locator:
                  'page:2',
                excerpt:
                  'Retrieved authority.',
              }),
            ]),
          ),
        ).rejects.toThrow(
          'legal_synthesis.ungrounded_citation',
        );
      },
    );

    it(
      'rejects a legal proposition that has no supporting evidence citation',
      async () => {
        const provider:
          LegalSynthesisProvider = {
            async synthesize() {
              return {
                summary:
                  'Answer.',

                propositions: [
                  {
                    text:
                      'A legal proposition.',

                    evidenceOrdinals:
                      [],
                  },
                ],

                unresolvedIssues:
                  [],

                insufficientEvidence:
                  false,
              };
            },
          };

        await expect(
          synthesizeGroundedLegalResearch(
            provider,
            packet([
              evidence({
                sourceId:
                  '30000000-0000-4000-8000-000000000001',
                versionId:
                  '30000000-0000-4000-8000-000000000002',
                passageId:
                  '30000000-0000-4000-8000-000000000003',
                locator:
                  'section:4',
                excerpt:
                  'Retrieved authority.',
              }),
            ]),
          ),
        ).rejects.toThrow(
          'legal_synthesis.ungrounded_proposition',
        );
      },
    );

    it(
      'fails closed outside Ghana',
      async () => {
        const good =
          packet([
            evidence({
              sourceId:
                '40000000-0000-4000-8000-000000000001',
              versionId:
                '40000000-0000-4000-8000-000000000002',
              passageId:
                '40000000-0000-4000-8000-000000000003',
              locator:
                'paragraph:1',
              excerpt:
                'Retrieved authority.',
            }),
          ]);

        const bad = {
          ...good,

          scope: {
            ...good.scope,
            countryCode:
              'NG',
          },
        } as unknown as GroundedResearchPacket;

        const provider:
          LegalSynthesisProvider = {
            synthesize:
              vi.fn(),
          };

        await expect(
          synthesizeGroundedLegalResearch(
            provider,
            bad,
          ),
        ).rejects.toThrow(
          'legal_synthesis.jurisdiction_not_supported',
        );

        expect(
          provider.synthesize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'passes only the retrieved authorized evidence to the provider',
      async () => {
        const first =
          evidence({
            sourceId:
              '50000000-0000-4000-8000-000000000001',
            versionId:
              '50000000-0000-4000-8000-000000000002',
            passageId:
              '50000000-0000-4000-8000-000000000003',
            locator:
              'paragraph:3',
            excerpt:
              'First authorized passage.',
          });

        const second =
          evidence({
            sourceId:
              '60000000-0000-4000-8000-000000000001',
            versionId:
              '60000000-0000-4000-8000-000000000002',
            passageId:
              '60000000-0000-4000-8000-000000000003',
            locator:
              'paragraph:9',
            excerpt:
              'Second authorized passage.',
          });

        const provider:
          LegalSynthesisProvider = {
            async synthesize(
              request,
            ) {
              expect(
                request.countryCode,
              ).toBe('GH');

              expect(
                request.evidence.map(
                  (item) => ({
                    ordinal:
                      item.ordinal,
                    sourceId:
                      item.source.sourceId,
                    versionId:
                      item.source.versionId,
                    excerpt:
                      item.excerpt,
                  }),
                ),
              ).toEqual([
                {
                  ordinal:
                    0,
                  sourceId:
                    first.source.sourceId,
                  versionId:
                    first.source.versionId,
                  excerpt:
                    first.excerpt,
                },
                {
                  ordinal:
                    1,
                  sourceId:
                    second.source.sourceId,
                  versionId:
                    second.source.versionId,
                  excerpt:
                    second.excerpt,
                },
              ]);

              return {
                summary:
                  'Grounded synthesis.',

                propositions: [
                  {
                    text:
                      'First grounded proposition.',

                    evidenceOrdinals:
                      [0],
                  },

                  {
                    text:
                      'Second grounded proposition.',

                    evidenceOrdinals:
                      [1],
                  },
                ],

                unresolvedIssues:
                  [],

                insufficientEvidence:
                  false,
              };
            },
          };

        const result =
          await synthesizeGroundedLegalResearch(
            provider,
            packet([
              first,
              second,
            ]),
          );

        expect(
          result.propositions,
        ).toHaveLength(2);

        expect(
          result.citations,
        ).toHaveLength(2);
      },
    );

    it(
      'allows an explicit insufficient-evidence provider result without invented propositions',
      async () => {
        const provider:
          LegalSynthesisProvider = {
            async synthesize() {
              return {
                summary:
                  'The retrieved material is insufficient to resolve the question.',

                propositions:
                  [],

                unresolvedIssues: [
                  'A controlling authority was not retrieved.',
                ],

                insufficientEvidence:
                  true,
              };
            },
          };

        const result =
          await synthesizeGroundedLegalResearch(
            provider,
            packet([
              evidence({
                sourceId:
                  '70000000-0000-4000-8000-000000000001',
                versionId:
                  '70000000-0000-4000-8000-000000000002',
                passageId:
                  '70000000-0000-4000-8000-000000000003',
                locator:
                  'paragraph:7',
                excerpt:
                  'Limited evidence.',
              }),
            ]),
          );

        expect(
          result.insufficientEvidence,
        ).toBe(true);

        expect(
          result.propositions,
        ).toEqual([]);

        expect(
          result.citations,
        ).toEqual([]);
      },
    );
  },
);
