import type { Tx } from '@legalintel/db';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  prepareRetrievalQuery,
  type AuthorizedRetrievalScope,
} from '../src/index.js';

import {
  PgPrivateRetrievalCandidateStore,
} from '../src/adapters/pg-private-candidate-store.js';

const baseScope: AuthorizedRetrievalScope = {
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
    '00000000-0000-4000-8000-000000000004',
  scopeMode:
    'ghana_corpus_and_matter_and_firm_knowledge',
};

const query =
  prepareRetrievalQuery({
    text:
      'employment contract',
    limit:
      7,
  });

describe(
  'PgPrivateRetrievalCandidateStore',
  () => {
    it(
      'filters Firm Knowledge to tenant RLS, active sources and exact versions before ranking',
      async () => {
        const queryFn =
          vi.fn().mockResolvedValue({
            rows: [
              {
                source_id:
                  '00000000-0000-4000-8000-000000000011',
                version_id:
                  '00000000-0000-4000-8000-000000000012',
                passage_id:
                  '00000000-0000-4000-8000-000000000013',
                locator:
                  'page:1/paragraph:1',
                content_hash:
                  'a'.repeat(64),
                score:
                  '0.75',
                stable_key:
                  '00000000-0000-4000-8000-000000000013',
                excerpt:
                  'employment contract evidence',
              },
            ],
          });

        const tx = {
          query: queryFn,
        } as unknown as Tx;

        const result =
          await new PgPrivateRetrievalCandidateStore(
            tx,
          ).searchCandidates(
            baseScope,
            query,
            'knowledge_source_version',
          );

        expect(result).toHaveLength(1);
        expect(result[0]?.contentHash)
          .toBe('a'.repeat(64));

        const sql =
          String(
            queryFn.mock.calls[0]?.[0],
          );

        expect(sql)
          .toContain(
            'knowledge.passages',
          );

        expect(sql)
          .toContain(
            'app.current_org_id()',
          );

        expect(sql)
          .toContain(
            "s.status =",
          );

        expect(sql)
          .toContain(
            "'active'",
          );

        expect(sql)
          .toContain(
            'p.search_vector',
          );

        expect(sql)
          .toContain(
            'ORDER BY',
          );
      },
    );

    it(
      'filters Matter Documents by exact task matter before ranking',
      async () => {
        const queryFn =
          vi.fn().mockResolvedValue({
            rows: [],
          });

        const tx = {
          query: queryFn,
        } as unknown as Tx;

        await new PgPrivateRetrievalCandidateStore(
          tx,
        ).searchCandidates(
          baseScope,
          query,
          'matter_document_version',
        );

        const sql =
          String(
            queryFn.mock.calls[0]?.[0],
          );

        expect(sql)
          .toContain(
            'matter_documents.passages',
          );

        expect(sql)
          .toContain(
            'p.matter_id',
          );

        expect(sql)
          .toContain(
            '$2::uuid',
          );

        expect(
          queryFn.mock.calls[0]?.[1],
        ).toEqual([
          query.normalizedText,
          baseScope.matterId,
          query.limit,
        ]);
      },
    );

    it(
      'does not query Matter Documents without a task matter',
      async () => {
        const queryFn =
          vi.fn();

        const tx = {
          query: queryFn,
        } as unknown as Tx;

        const result =
          await new PgPrivateRetrievalCandidateStore(
            tx,
          ).searchCandidates(
            {
              ...baseScope,
              matterId:
                null,
              scopeMode:
                'ghana_corpus_and_firm_knowledge',
            },
            query,
            'matter_document_version',
          );

        expect(result).toEqual([]);
        expect(queryFn)
          .not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed for non-Ghana scope',
      async () => {
        const queryFn =
          vi.fn();

        const tx = {
          query: queryFn,
        } as unknown as Tx;

        const result =
          await new PgPrivateRetrievalCandidateStore(
            tx,
          ).searchCandidates(
            {
              ...baseScope,
              countryCode:
                'NG' as 'GH',
            },
            query,
            'knowledge_source_version',
          );

        expect(result).toEqual([]);
        expect(queryFn)
          .not.toHaveBeenCalled();
      },
    );

    it(
      'does not handle corpus candidates',
      async () => {
        const queryFn =
          vi.fn();

        const tx = {
          query: queryFn,
        } as unknown as Tx;

        const result =
          await new PgPrivateRetrievalCandidateStore(
            tx,
          ).searchCandidates(
            baseScope,
            query,
            'corpus_document_version',
          );

        expect(result).toEqual([]);
        expect(queryFn)
          .not.toHaveBeenCalled();
      },
    );
  },
);
