import {
  randomUUID,
} from 'node:crypto';

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
} from '@legalintel/iam';

import {
  corpusMigrations,
} from '@legalintel/legal-corpus';

import {
  knowledgeMigrations,
} from '@legalintel/knowledge';

import {
  matterDocumentMigrations,
} from '@legalintel/matter-documents';

import {
  pgWorkspaceStore,
  workspaceMigrations,
} from '@legalintel/workspace';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  PgPrivateRetrievalCandidateStore,
  prepareRetrievalQuery,
  type AuthorizedRetrievalScope,
} from '../src/index.js';

let database: TestDatabase;

const organizationA =
  randomUUID();

const organizationB =
  randomUUID();

let jurisdictionId =
  '';

let matterA =
  '';

let matterOther =
  '';

const knowledgeSourceA =
  randomUUID();

const knowledgeVersionA =
  randomUUID();

const knowledgeSourceB =
  randomUUID();

const knowledgeVersionB =
  randomUUID();

const matterDocumentA =
  randomUUID();

const matterVersionA =
  randomUUID();

const matterDocumentOther =
  randomUUID();

const matterVersionOther =
  randomUUID();

function orgValue() {
  return organizationA as Parameters<
    typeof withTenantTransaction
  >[1]['organizationId'];
}

function orgBValue() {
  return organizationB as Parameters<
    typeof withTenantTransaction
  >[1]['organizationId'];
}

function scope(
  matterId: string | null,
): AuthorizedRetrievalScope {
  return {
    organizationId:
      organizationA,
    taskId:
      randomUUID(),
    taskScopeRevision:
      1,
    jurisdictionId,
    countryCode:
      'GH',
    matterId,
    scopeMode:
      matterId === null
        ? 'ghana_corpus_and_firm_knowledge'
        : 'ghana_corpus_and_matter_and_firm_knowledge',
  };
}

async function insertKnowledgeFixture(
  organizationId:
    ReturnType<typeof orgValue>,
  sourceId: string,
  versionId: string,
  label: string,
) {
  const pool =
    database.poolFor('app');

  await withTenantTransaction(
    pool,
    {
      organizationId,
    },
    async (tx) => {
      await tx.query(
        `
          INSERT INTO knowledge.sources (
            organization_id,
            id,
            name,
            status
          )
          VALUES (
            app.current_org_id(),
            $1,
            $2,
            'active'
          )
        `,
        [
          sourceId,
          `${label} source`,
        ],
      );

      await tx.query(
        `
          INSERT INTO knowledge.source_versions (
            organization_id,
            id,
            source_id,
            version_number,
            original_filename,
            mime_type,
            storage_key,
            content_sha256,
            size_bytes
          )
          VALUES (
            app.current_org_id(),
            $1,
            $2,
            1,
            $3,
            'text/plain',
            $4,
            $5,
            100
          )
        `,
        [
          versionId,
          sourceId,
          `${label}.txt`,
          `firm/${sourceId}/${versionId}.txt`,
          'a'.repeat(64),
        ],
      );

      const text =
        `privateemploymentneedle ${label} employment contract evidence`;

      await tx.query(
        `
          INSERT INTO knowledge.passages (
            organization_id,
            source_id,
            version_id,
            ordinal,
            locator,
            text,
            text_sha256
          )
          VALUES (
            app.current_org_id(),
            $1,
            $2,
            0,
            'page:1/paragraph:1',
            $3,
            encode(
              sha256(
                convert_to(
                  $3,
                  'UTF8'
                )
              ),
              'hex'
            )
          )
        `,
        [
          sourceId,
          versionId,
          text,
        ],
      );
    },
  );
}

async function insertMatterFixture(
  documentId: string,
  versionId: string,
  matterId: string,
  label: string,
) {
  const pool =
    database.poolFor('app');

  await withTenantTransaction(
    pool,
    {
      organizationId:
        orgValue(),
    },
    async (tx) => {
      await tx.query(
        `
          INSERT INTO matter_documents.documents (
            organization_id,
            id,
            matter_id,
            name,
            status
          )
          VALUES (
            app.current_org_id(),
            $1,
            $2,
            $3,
            'active'
          )
        `,
        [
          documentId,
          matterId,
          `${label} document`,
        ],
      );

      await tx.query(
        `
          INSERT INTO matter_documents.document_versions (
            organization_id,
            id,
            matter_id,
            document_id,
            version_number,
            original_filename,
            mime_type,
            storage_key,
            content_sha256,
            size_bytes
          )
          VALUES (
            app.current_org_id(),
            $1,
            $2,
            $3,
            1,
            $4,
            'text/plain',
            $5,
            $6,
            100
          )
        `,
        [
          versionId,
          matterId,
          documentId,
          `${label}.txt`,
          `matter/${matterId}/${documentId}/${versionId}.txt`,
          'b'.repeat(64),
        ],
      );

      const text =
        `privatematterneedle ${label} confidential matter evidence`;

      await tx.query(
        `
          INSERT INTO matter_documents.passages (
            organization_id,
            matter_id,
            document_id,
            version_id,
            ordinal,
            locator,
            text,
            text_sha256
          )
          VALUES (
            app.current_org_id(),
            $1,
            $2,
            $3,
            0,
            'page:1/paragraph:1',
            $4,
            encode(
              sha256(
                convert_to(
                  $4,
                  'UTF8'
                )
              ),
              'hex'
            )
          )
        `,
        [
          matterId,
          documentId,
          versionId,
          text,
        ],
      );
    },
  );
}

beforeAll(async () => {
  database =
    await createTestDatabase({
      migrationSets: [
        platformMigrations,
        iamMigrations,
        corpusMigrations,
        workspaceMigrations,
        knowledgeMigrations,
        matterDocumentMigrations,
      ],
    });

  jurisdictionId =
    await database.withAdmin(
      async (admin) => {
        for (
          const [
            id,
            suffix,
          ] of [
            [
              organizationA,
              'A',
            ],
            [
              organizationB,
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
              id,
              `Phase 8F Firm ${suffix}`,
              `phase8f-${id}`,
            ],
          );
        }

        const result =
          await admin.query<{
            id: string;
          }>(
            `
              INSERT INTO corpus.jurisdictions (
                code,
                name,
                kind,
                is_synthetic
              )
              VALUES (
                'GH',
                'Ghana',
                'country',
                false
              )
              RETURNING id
            `,
          );

        const id =
          result.rows[0]?.id;

        if (!id) {
          throw new Error(
            'Phase 8F Ghana jurisdiction fixture missing.',
          );
        }

        return id;
      },
    );

  const pool =
    database.poolFor('app');

  const matters =
    await withTenantTransaction(
      pool,
      {
        organizationId:
          orgValue(),
      },
      async (tx) => {
        const client =
          await pgWorkspaceStore
            .createClient(
              tx,
              {
                name:
                  'Phase 8F Client',
              },
            );

        const first =
          await pgWorkspaceStore
            .createMatter(
              tx,
              {
                clientId:
                  client.id,
                jurisdictionId:
                  jurisdictionId as Parameters<
                    typeof pgWorkspaceStore.createMatter
                  >[1]['jurisdictionId'],
                name:
                  'Phase 8F Allowed Matter',
              },
            );

        const second =
          await pgWorkspaceStore
            .createMatter(
              tx,
              {
                clientId:
                  client.id,
                jurisdictionId:
                  jurisdictionId as Parameters<
                    typeof pgWorkspaceStore.createMatter
                  >[1]['jurisdictionId'],
                name:
                  'Phase 8F Other Matter',
              },
            );

        return {
          first:
            first.id,
          second:
            second.id,
        };
      },
    );

  matterA =
    String(
      matters.first,
    );

  matterOther =
    String(
      matters.second,
    );

  await insertKnowledgeFixture(
    orgValue(),
    knowledgeSourceA,
    knowledgeVersionA,
    'tenant-alpha',
  );

  await insertKnowledgeFixture(
    orgBValue(),
    knowledgeSourceB,
    knowledgeVersionB,
    'tenant-beta',
  );

  await insertMatterFixture(
    matterDocumentA,
    matterVersionA,
    matterA,
    'allowed-matter',
  );

  await insertMatterFixture(
    matterDocumentOther,
    matterVersionOther,
    matterOther,
    'other-matter',
  );
});

afterAll(async () => {
  await database.dispose();
});

describe(
  'Phase 8F private PostgreSQL retrieval',
  () => {
    it(
      'keeps Firm Knowledge retrieval inside the current tenant',
      async () => {
        const pool =
          database.poolFor('app');

        const result =
          await withTenantTransaction(
            pool,
            {
              organizationId:
                orgValue(),
            },
            async (tx) =>
              new PgPrivateRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope(null),
                prepareRetrievalQuery({
                  text:
                    'privateemploymentneedle',
                }),
                'knowledge_source_version',
              ),
          );

        expect(result)
          .toHaveLength(1);

        expect(
          result[0]?.sourceId,
        ).toBe(
          knowledgeSourceA,
        );

        expect(
          result[0]?.versionId,
        ).toBe(
          knowledgeVersionA,
        );

        expect(
          result[0]?.excerpt,
        ).toContain(
          'tenant-alpha',
        );

        expect(
          result[0]?.excerpt,
        ).not.toContain(
          'tenant-beta',
        );

        expect(
          result[0]?.contentHash,
        ).toMatch(
          /^[0-9a-f]{64}$/,
        );
      },
    );

    it(
      'keeps Matter Document retrieval inside the exact task matter',
      async () => {
        const pool =
          database.poolFor('app');

        const result =
          await withTenantTransaction(
            pool,
            {
              organizationId:
                orgValue(),
            },
            async (tx) =>
              new PgPrivateRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope(
                  matterA,
                ),
                prepareRetrievalQuery({
                  text:
                    'privatematterneedle',
                }),
                'matter_document_version',
              ),
          );

        expect(result)
          .toHaveLength(1);

        expect(
          result[0]?.sourceId,
        ).toBe(
          matterDocumentA,
        );

        expect(
          result[0]?.versionId,
        ).toBe(
          matterVersionA,
        );

        expect(
          result[0]?.excerpt,
        ).toContain(
          'allowed-matter',
        );

        expect(
          result[0]?.excerpt,
        ).not.toContain(
          'other-matter',
        );
      },
    );

    it(
      'removes archived Firm Knowledge from retrieval without deleting evidence',
      async () => {
        const pool =
          database.poolFor('app');

        await withTenantTransaction(
          pool,
          {
            organizationId:
              orgValue(),
          },
          async (tx) => {
            await tx.query(
              `
                UPDATE knowledge.sources
                   SET status =
                     'archived'
                 WHERE id =
                   $1
              `,
              [
                knowledgeSourceA,
              ],
            );
          },
        );

        const result =
          await withTenantTransaction(
            pool,
            {
              organizationId:
                orgValue(),
            },
            async (tx) =>
              new PgPrivateRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope(null),
                prepareRetrievalQuery({
                  text:
                    'privateemploymentneedle',
                }),
                'knowledge_source_version',
              ),
          );

        expect(result)
          .toEqual([]);

        const count =
          await database.withAdmin(
            async (admin) =>
              (
                await admin.query<{
                  n: string;
                }>(
                  `
                    SELECT count(*) AS n
                    FROM knowledge.passages
                    WHERE source_id = $1
                  `,
                  [
                    knowledgeSourceA,
                  ],
                )
              ).rows[0]?.n,
          );

        expect(count)
          .toBe('1');
      },
    );

    it(
      'removes archived Matter Documents from retrieval without deleting evidence',
      async () => {
        const pool =
          database.poolFor('app');

        await withTenantTransaction(
          pool,
          {
            organizationId:
              orgValue(),
          },
          async (tx) => {
            await tx.query(
              `
                UPDATE matter_documents.documents
                   SET status =
                     'archived'
                 WHERE id =
                   $1
                   AND matter_id =
                     $2
              `,
              [
                matterDocumentA,
                matterA,
              ],
            );
          },
        );

        const result =
          await withTenantTransaction(
            pool,
            {
              organizationId:
                orgValue(),
            },
            async (tx) =>
              new PgPrivateRetrievalCandidateStore(
                tx,
              ).searchCandidates(
                scope(
                  matterA,
                ),
                prepareRetrievalQuery({
                  text:
                    'privatematterneedle',
                }),
                'matter_document_version',
              ),
          );

        expect(result)
          .toEqual([]);

        const count =
          await database.withAdmin(
            async (admin) =>
              (
                await admin.query<{
                  n: string;
                }>(
                  `
                    SELECT count(*) AS n
                    FROM matter_documents.passages
                    WHERE document_id = $1
                  `,
                  [
                    matterDocumentA,
                  ],
                )
              ).rows[0]?.n,
          );

        expect(count)
          .toBe('1');
      },
    );
  },
);
