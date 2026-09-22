import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  Tx,
} from '@legalintel/db';

import type {
  AuthzContext,
} from '@legalintel/iam';

import {
  prepareRetrievalQuery,
  recordRetrievalSession,
  type RetrievalResult,
  type RetrievalSessionStore,
} from '../src/index.js';

type Human =
  Extract<
    AuthzContext['principal'],
    {
      kind: 'user';
    }
  >;

const context:
  AuthzContext = {
    principal: {
      kind:
        'user',
      userId:
        '00000000-0000-4000-8000-000000000001' as Human['userId'],
    },

    organizationId:
      '00000000-0000-4000-8000-000000000002' as NonNullable<
        AuthzContext['organizationId']
      >,

    roles: [
      'owner',
    ],

    permissions:
      new Set(),
  };

function result():
  RetrievalResult {
  const query =
    prepareRetrievalQuery({
      text:
        'VERY PRIVATE client query',
      limit:
        5,
    });

  return {
    scope: {
      organizationId:
        String(
          context.organizationId,
        ),
      taskId:
        '00000000-0000-4000-8000-000000000003',
      taskScopeRevision:
        2,
      jurisdictionId:
        '00000000-0000-4000-8000-000000000004',
      countryCode:
        'GH',
      matterId:
        '00000000-0000-4000-8000-000000000005',
      scopeMode:
        'ghana_corpus_and_matter_and_firm_knowledge',
    },

    query,

    evidence: [
      {
        source: {
          kind:
            'knowledge_source_version',
          sourceId:
            '00000000-0000-4000-8000-000000000006',
          versionId:
            '00000000-0000-4000-8000-000000000007',
        },

        passage: {
          passageId:
            '00000000-0000-4000-8000-000000000008',
          locator:
            'page:1',
          contentHash:
            'a'.repeat(64),
        },

        score:
          0.9,

        stableKey:
          'stable',

        excerpt:
          'EXTREMELY PRIVATE document text',
      },
    ],
  };
}

describe(
  'recordRetrievalSession',
  () => {
    it(
      'passes only structured retrieval data to persistence and privacy-safe data to audit',
      async () => {
        const writes:
          Array<{
            sql: string;
            values:
              readonly unknown[]
              | undefined;
          }> = [];

        const tx = {
          async query(
            sql: string,
            values?: readonly unknown[],
          ) {
            writes.push({
              sql,
              values,
            });

            return {
              rows: [],
              rowCount:
                1,
            };
          },
        } as unknown as Tx;

        const store: RetrievalSessionStore = {
          record:
            vi.fn(
              async (
                _tx,
                input,
              ) => ({
                id:
                  input.id,
                organizationId:
                  input.organizationId,
                taskId:
                  input.taskId,
                taskScopeRevision:
                  input.taskScopeRevision,
                jurisdictionId:
                  input.jurisdictionId,
                matterId:
                  input.matterId,
                scopeMode:
                  input.scopeMode,
                queryFingerprint:
                  input.query.fingerprint,
                requestedLimit:
                  input.query.limit,
                resultCount:
                  input.evidence.length,
                createdBy:
                  input.createdBy,
              }),
            ),
        };

        const retrieval =
          result();

        await recordRetrievalSession(
          store,
          tx,
          context,
          {
            id:
              '00000000-0000-4000-8000-000000000009',
            result:
              retrieval,
          },
        );

        expect(
          store.record,
        ).toHaveBeenCalledTimes(1);

        const serializedWrites =
          JSON.stringify(writes);

        expect(serializedWrites)
          .not.toContain(
            'VERY PRIVATE client query',
          );

        expect(serializedWrites)
          .not.toContain(
            'EXTREMELY PRIVATE document text',
          );

        expect(serializedWrites)
          .toContain(
            retrieval.query.fingerprint,
          );
      },
    );

    it(
      'rejects a tenant mismatch',
      async () => {
        const store: RetrievalSessionStore = {
          record:
            vi.fn(),
        };

        const tx = {
          query:
            vi.fn(),
        } as unknown as Tx;

        await expect(
          recordRetrievalSession(
            store,
            tx,
            {
              ...context,
              organizationId:
                '00000000-0000-4000-8000-000000000099' as NonNullable<
                  AuthzContext['organizationId']
                >,
            },
            {
              id:
                '00000000-0000-4000-8000-000000000009',
              result:
                result(),
            },
          ),
        ).rejects.toThrow(
          'retrieval.session_scope_denied',
        );

        expect(
          store.record,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
