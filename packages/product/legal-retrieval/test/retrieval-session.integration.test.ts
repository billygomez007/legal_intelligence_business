import {
  randomUUID,
} from 'node:crypto';

import {
  auditMigrations,
} from '@legalintel/audit';

import {
  platformMigrations,
  withTenantTransaction,
} from '@legalintel/db';

import {
  createTestDatabase,
  type TestDatabase,
} from '@legalintel/db/testing';

import {
  iamMigrations,
  type AuthzContext,
} from '@legalintel/iam';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  legalRetrievalMigrations,
  pgRetrievalSessionStore,
  prepareRetrievalQuery,
  recordRetrievalSession,
  type RetrievalResult,
} from '../src/index.js';

let database:
  TestDatabase;

const organizationA =
  randomUUID();

const organizationB =
  randomUUID();

const userA =
  randomUUID();

const userB =
  randomUUID();

const jurisdiction =
  randomUUID();

type Human =
  Extract<
    AuthzContext['principal'],
    {
      kind: 'user';
    }
  >;

function context(
  organizationId:
    string,
  userId:
    string,
): AuthzContext {
  return {
    principal: {
      kind:
        'user',
      userId:
        userId as Human['userId'],
    },

    organizationId:
      organizationId as NonNullable<
        AuthzContext['organizationId']
      >,

    roles: [
      'owner',
    ],

    permissions:
      new Set(),
  };
}

function result(
  organizationId:
    string,
): RetrievalResult {
  return {
    scope: {
      organizationId,
      taskId:
        randomUUID(),
      taskScopeRevision:
        1,
      jurisdictionId:
        jurisdiction,
      countryCode:
        'GH',
      matterId:
        null,
      scopeMode:
        'ghana_corpus',
    },

    query:
      prepareRetrievalQuery({
        text:
          'SYNTHETIC PRIVATE QUERY THAT MUST NOT PERSIST',
        limit:
          5,
      }),

    evidence: [
      {
        source: {
          kind:
            'corpus_document_version',
          sourceId:
            randomUUID(),
          versionId:
            randomUUID(),
        },

        passage: {
          passageId:
            randomUUID(),
          locator:
            'paragraph:1',
          contentHash:
            'a'.repeat(64),
        },

        score:
          0.75,

        stableKey:
          randomUUID(),

        excerpt:
          'SYNTHETIC PRIVATE EXCERPT THAT MUST NOT PERSIST',
      },
    ],
  };
}

beforeAll(
  async () => {
    database =
      await createTestDatabase({
        migrationSets: [
          platformMigrations,
          iamMigrations,
          auditMigrations,
          legalRetrievalMigrations,
        ],
      });

    await database.withAdmin(
      async (admin) => {
        for (
          const [
            organizationId,
            userId,
            suffix,
          ] of [
            [
              organizationA,
              userA,
              'A',
            ],
            [
              organizationB,
              userB,
              'B',
            ],
          ] as const
        ) {
          await admin.query(
            `
              INSERT INTO iam.organizations (
                id,
                name,
                slug,
                kind
              )
              VALUES (
                $1,
                $2,
                $3,
                'firm'
              )
            `,
            [
              organizationId,
              `Phase 8H Firm ${suffix}`,
              `phase8h-${organizationId}`,
            ],
          );

          await admin.query(
            `
              INSERT INTO iam.users (
                id,
                email,
                status
              )
              VALUES (
                $1,
                $2,
                'active'
              )
            `,
            [
              userId,
              `phase8h-${suffix.toLowerCase()}@example.test`,
            ],
          );
        }
      },
    );
  },
);

afterAll(
  async () => {
    await database.dispose();
  },
);

describe(
  'Phase 8H retrieval session persistence',
  () => {
    it(
      'persists fingerprint and exact provenance without raw query or excerpt',
      async () => {
        const retrieval =
          result(
            organizationA,
          );

        const sessionId =
          randomUUID();

        await withTenantTransaction(
          database.poolFor(
            'app',
          ),
          {
            organizationId:
              organizationA as Parameters<
                typeof withTenantTransaction
              >[1]['organizationId'],
          },
          async (tx) => {
            await recordRetrievalSession(
              pgRetrievalSessionStore,
              tx,
              context(
                organizationA,
                userA,
              ),
              {
                id:
                  sessionId,
                result:
                  retrieval,
              },
            );
          },
        );

        const stored =
          await database.withAdmin(
            async (admin) => {
              const session =
                await admin.query<{
                  query_fingerprint:
                    string;
                  result_count:
                    number;
                }>(
                  `
                    SELECT
                      query_fingerprint,
                      result_count
                    FROM legal_retrieval.sessions
                    WHERE id = $1
                  `,
                  [
                    sessionId,
                  ],
                );

              const evidence =
                await admin.query<{
                  source_id:
                    string;
                  version_id:
                    string;
                  passage_id:
                    string | null;
                  content_sha256:
                    string | null;
                }>(
                  `
                    SELECT
                      source_id::text,
                      version_id::text,
                      passage_id::text,
                      content_sha256
                    FROM legal_retrieval.session_evidence
                    WHERE session_id = $1
                  `,
                  [
                    sessionId,
                  ],
                );

              const audit =
                await admin.query<{
                  metadata:
                    Record<
                      string,
                      unknown
                    >;
                }>(
                  `
                    SELECT metadata
                    FROM audit.events
                    WHERE resource_id = $1
                      AND action =
                        'legal_retrieval.session_recorded'
                  `,
                  [
                    sessionId,
                  ],
                );

              return {
                session:
                  session.rows[0],
                evidence:
                  evidence.rows,
                audit:
                  audit.rows[0],
              };
            },
          );

        expect(
          stored.session
            ?.query_fingerprint,
        ).toBe(
          retrieval.query.fingerprint,
        );

        expect(
          stored.session
            ?.result_count,
        ).toBe(1);

        expect(
          stored.evidence,
        ).toHaveLength(1);

        const everything =
          JSON.stringify(
            stored,
          );

        expect(everything)
          .not.toContain(
            'SYNTHETIC PRIVATE QUERY THAT MUST NOT PERSIST',
          );

        expect(everything)
          .not.toContain(
            'SYNTHETIC PRIVATE EXCERPT THAT MUST NOT PERSIST',
          );

        expect(
          everything,
        ).toContain(
          retrieval.query.fingerprint,
        );

        expect(
          Object.keys(
            stored.audit
              ?.metadata
              ?? {},
          ).sort(),
        ).toEqual([
          'corpus_count',
          'knowledge_count',
          'matter_document_count',
          'query_fingerprint',
          'result_count',
          'task_id',
          'task_scope_revision',
        ]);
      },
    );

    it(
      'enforces tenant isolation with FORCE RLS',
      async () => {
        const sessionId =
          randomUUID();

        await withTenantTransaction(
          database.poolFor(
            'app',
          ),
          {
            organizationId:
              organizationA as Parameters<
                typeof withTenantTransaction
              >[1]['organizationId'],
          },
          async (tx) => {
            await recordRetrievalSession(
              pgRetrievalSessionStore,
              tx,
              context(
                organizationA,
                userA,
              ),
              {
                id:
                  sessionId,
                result:
                  result(
                    organizationA,
                  ),
              },
            );
          },
        );

        const invisible =
          await withTenantTransaction(
            database.poolFor(
              'app',
            ),
            {
              organizationId:
                organizationB as Parameters<
                  typeof withTenantTransaction
                >[1]['organizationId'],
            },
            async (tx) =>
              tx.query(
                `
                  SELECT 1
                  FROM legal_retrieval.sessions
                  WHERE id = $1
                `,
                [
                  sessionId,
                ],
              ),
          );

        expect(
          invisible.rowCount,
        ).toBe(0);
      },
    );

    it.each([
      'sessions',
      'session_evidence',
    ])(
      'rejects UPDATE and DELETE of immutable %s',
      async (table) => {
        const sessionId =
          randomUUID();

        await withTenantTransaction(
          database.poolFor(
            'app',
          ),
          {
            organizationId:
              organizationA as Parameters<
                typeof withTenantTransaction
              >[1]['organizationId'],
          },
          async (tx) => {
            await recordRetrievalSession(
              pgRetrievalSessionStore,
              tx,
              context(
                organizationA,
                userA,
              ),
              {
                id:
                  sessionId,
                result:
                  result(
                    organizationA,
                  ),
              },
            );
          },
        );

        for (
          const operation
          of [
            'UPDATE',
            'DELETE',
          ]
        ) {
          const sql =
            operation
              === 'UPDATE'
              ? `
                  UPDATE legal_retrieval.${table}
                  SET organization_id =
                    organization_id
                  WHERE ${
                    table
                      === 'sessions'
                      ? 'id'
                      : 'session_id'
                  } = $1
                `
              : `
                  DELETE FROM legal_retrieval.${table}
                  WHERE ${
                    table
                      === 'sessions'
                      ? 'id'
                      : 'session_id'
                  } = $1
                `;

          await expect(
            database.withAdmin(
              (admin) =>
                admin.query(
                  sql,
                  [
                    sessionId,
                  ],
                ),
            ),
          ).rejects.toMatchObject({
            code:
              '42501',
            hint:
              'legal_retrieval.immutable_history',
          });
        }
      },
    );
  },
);
