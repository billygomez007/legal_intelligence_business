import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  corpusStore,
  sha256,
} from '../src/index.js';

import {
  createHarness,
  type Harness,
} from './harness.js';

import {
  PgCorpusRetrievalCandidateStore,
  prepareRetrievalQuery,
  type AuthorizedRetrievalScope,
} from '../../../product/legal-retrieval/src/index.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.dispose();
});

let sequence = 0;

function unique(
  label: string,
): string {
  sequence += 1;

  return [
    label,
    Date.now().toString(36),
    sequence.toString(36),
  ].join('-');
}

describe(
  'Phase 8 live PostgreSQL corpus retrieval',
  () => {
    it(
      'returns a published passage with ai_processing rights and removes it after AI rights are revoked',
      async () => {
        const world =
          await h.asDataops(
            async (tx) => {
              const jurisdictionId =
                await corpusStore
                  .createJurisdiction(
                    tx,
                    {
                      code:
                        `ZZ-P8-${sequence + 1}`,
                      name:
                        unique(
                          'SYNTHETIC Phase 8 jurisdiction',
                        ),
                      kind:
                        'country',
                      isSynthetic:
                        true,
                    },
                  );

              const sourceId =
                await corpusStore
                  .registerSource(
                    tx,
                    {
                      jurisdictionId,
                      name:
                        unique(
                          'SYNTHETIC Phase 8 source',
                        ),
                      kind:
                        'publisher',
                    },
                  );

              await corpusStore
                .recordRightsDecision(
                  tx,
                  {
                    sourceId,
                    status:
                      'approved',
                    allowedUses: [
                      'display',
                      'index_search',
                      'ai_processing',
                    ],
                    evidenceReference:
                      'SYNTHETIC-PHASE8-RIGHTS',
                    decidedBy:
                      h.staff.rights,
                  },
                );

              return {
                jurisdictionId,
                sourceId,
              };
            },
          );

        const drafted =
          await h.pendingCase(
            world,
          );

await h.verifyAll(
          drafted.versionId,
        );

        await h.attest(
          drafted.versionId,
        );

        await h.approve(
          drafted.versionId,
          undefined,
          {
            attest: false,
          },
        );

        await h.publish(
          drafted.versionId,
        );

        const scope:
          AuthorizedRetrievalScope = {
            organizationId:
              'phase8-test-org',

            taskId:
              'phase8-test-task',

            taskScopeRevision:
              1,

            jurisdictionId:
              String(
                world.jurisdictionId,
              ),

            countryCode:
              'GH',

            matterId:
              null,

            scopeMode:
              'ghana_corpus',
          };

        const query =
          prepareRetrievalQuery({
            text:
              'SYNTHETIC first passage',
            limit:
              10,
          });

        const first =
          await h.asApp(
            async (tx) =>
              new PgCorpusRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope,
                query,
                'corpus_document_version',
              ),
          );

        expect(
          first,
        ).toHaveLength(1);

        const evidence =
          first[0];

        expect(
          evidence,
        ).toBeDefined();

        expect(
          evidence?.sourceId,
        ).toBe(
          String(
            drafted.documentId,
          ),
        );

        expect(
          evidence?.versionId,
        ).toBe(
          String(
            drafted.versionId,
          ),
        );

        expect(
          evidence?.locator,
        ).toBe('¶1');

        expect(
          evidence?.excerpt,
        ).toContain(
          'SYNTHETIC first passage',
        );

        expect(
          evidence?.score,
        ).toBeGreaterThan(0);

        /*
         * Keep display + index_search so ordinary application visibility
         * remains valid, but remove ai_processing.
         */
        await h.asDataops(
          async (tx) => {
            await corpusStore
              .recordRightsDecision(
                tx,
                {
                  sourceId:
                    world.sourceId,

                  status:
                    'approved',

                  allowedUses: [
                    'display',
                    'index_search',
                  ],

                  evidenceReference:
                    'SYNTHETIC-PHASE8-AI-REMOVED',

                  decidedBy:
                    h.staff.rights,
                },
              );
          },
        );

        const stillPublished =
          await h.admin(
            async (client) => {
              const result =
                await client.query<{
                  lifecycle_state:
                    string;
                }>(
                  `
                    SELECT lifecycle_state
                    FROM corpus.document_versions
                    WHERE id = $1
                  `,
                  [
                    drafted.versionId,
                  ],
                );

              return result.rows[0]
                ?.lifecycle_state;
            },
          );

        expect(
          stillPublished,
        ).toBe(
          'published',
        );

        const allowsDisplay =
          await h.asApp(
            async (tx) =>
              (
                await tx.query<{
                  ok: boolean;
                }>(
                  `
                    SELECT corpus.source_allows(
                      $1,
                      'display'
                    ) AS ok
                  `,
                  [
                    world.sourceId,
                  ],
                )
              ).rows[0]?.ok,
          );

        const allowsAi =
          await h.asApp(
            async (tx) =>
              (
                await tx.query<{
                  ok: boolean;
                }>(
                  `
                    SELECT corpus.source_allows(
                      $1,
                      'ai_processing'
                    ) AS ok
                  `,
                  [
                    world.sourceId,
                  ],
                )
              ).rows[0]?.ok,
          );

        expect(
          allowsDisplay,
        ).toBe(true);

        expect(
          allowsAi,
        ).toBe(false);

        const afterRightsChange =
          await h.asApp(
            async (tx) =>
              new PgCorpusRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope,
                query,
                'corpus_document_version',
              ),
          );

        expect(
          afterRightsChange,
        ).toEqual([]);
      },
    );

    it(
      'does not retrieve an unpublished matching passage',
      async () => {
        const world =
          await h.asDataops(
            async (tx) => {
              const jurisdictionId =
                await corpusStore
                  .createJurisdiction(
                    tx,
                    {
                      code:
                        `ZZ-U8-${sequence + 1}`,

                      name:
                        unique(
                          'SYNTHETIC Phase 8 unpublished jurisdiction',
                        ),

                      kind:
                        'country',

                      isSynthetic:
                        true,
                    },
                  );

              const sourceId =
                await corpusStore
                  .registerSource(
                    tx,
                    {
                      jurisdictionId,

                      name:
                        unique(
                          'SYNTHETIC unpublished source',
                        ),

                      kind:
                        'publisher',
                    },
                  );

              await corpusStore
                .recordRightsDecision(
                  tx,
                  {
                    sourceId,

                    status:
                      'approved',

                    allowedUses: [
                      'display',
                      'index_search',
                      'ai_processing',
                    ],

                    evidenceReference:
                      'SYNTHETIC-UNPUBLISHED',

                    decidedBy:
                      h.staff.rights,
                  },
                );

              return {
                jurisdictionId,
                sourceId,
              };
            },
          );

        await h.asIngest(
          async (tx) => {
            const documentId =
              await corpusStore
                .createDocument(
                  tx,
                  {
                    jurisdictionId:
                      world.jurisdictionId,

                    documentType:
                      'case',

                    title:
                      '[SYNTHETIC] Unpublished Phase 8 Case',
                  },
                );

            const seed =
              unique(
                'unpublished',
              );

            const versionId =
              await corpusStore
                .createVersion(
                  tx,
                  {
                    documentId,

                    jurisdictionId:
                      world.jurisdictionId,

                    versionNumber:
                      1,

                    sourceId:
                      world.sourceId,

                    acquiredAt:
                      new Date(),

                    contentChecksum:
                      sha256(seed),

                    storageKey:
                      `synthetic/${seed}`,

                    pipelineVersion:
                      'phase8-live-test-1',
                  },
                );

            await corpusStore
              .addPassages(
                tx,
                versionId,
                [
                  {
                    ordinal:
                      0,

                    locator:
                      '¶1',

                    text:
                      'uniquephaseeightunpublished searchable contract evidence',
                  },
                ],
              );
          },
        );

        const scope:
          AuthorizedRetrievalScope = {
            organizationId:
              'phase8-test-org',

            taskId:
              'phase8-test-task',

            taskScopeRevision:
              1,

            jurisdictionId:
              String(
                world.jurisdictionId,
              ),

            countryCode:
              'GH',

            matterId:
              null,

            scopeMode:
              'ghana_corpus',
          };

        const result =
          await h.asApp(
            async (tx) =>
              new PgCorpusRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope,

                prepareRetrievalQuery({
                  text:
                    'uniquephaseeightunpublished',
                }),

                'corpus_document_version',
              ),
          );

        expect(
          result,
        ).toEqual([]);
      },
    );
  },
);
