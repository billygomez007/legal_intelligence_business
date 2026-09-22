import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  AuthorizedRetrievalScope,
} from '@legalintel/legal-retrieval';

import {
  retrievalSourceKindsForScope,
} from '../src/index.js';

function scope(
  scopeMode:
    string,
  matterId:
    string | null,
): AuthorizedRetrievalScope {
  return {
    organizationId:
      '00000000-0000-4000-8000-000000000001',

    taskId:
      '00000000-0000-4000-8000-000000000002',

    taskScopeRevision:
      3,

    jurisdictionId:
      '00000000-0000-4000-8000-000000000003',

    countryCode:
      'GH',

    matterId,

    scopeMode,
  };
}

describe(
  'Phase 9C server-owned retrieval source matrix',
  () => {
    it(
      'uses corpus only for ghana_corpus',
      () => {
        expect(
          retrievalSourceKindsForScope(
            scope(
              'ghana_corpus',
              null,
            ),
          ),
        ).toEqual([
          'corpus_document_version',
        ]);
      },
    );

    it(
      'uses corpus and Firm Knowledge for firm-knowledge scope',
      () => {
        expect(
          retrievalSourceKindsForScope(
            scope(
              'ghana_corpus_and_firm_knowledge',
              null,
            ),
          ),
        ).toEqual([
          'corpus_document_version',
          'knowledge_source_version',
        ]);
      },
    );

    it(
      'uses corpus and Matter Documents for selected Matter scope',
      () => {
        expect(
          retrievalSourceKindsForScope(
            scope(
              'ghana_corpus_and_matter',
              '00000000-0000-4000-8000-000000000099',
            ),
          ),
        ).toEqual([
          'corpus_document_version',
          'matter_document_version',
        ]);
      },
    );

    it(
      'uses all three sources only for the combined scope',
      () => {
        expect(
          retrievalSourceKindsForScope(
            scope(
              'ghana_corpus_and_matter_and_firm_knowledge',
              '00000000-0000-4000-8000-000000000099',
            ),
          ),
        ).toEqual([
          'corpus_document_version',
          'knowledge_source_version',
          'matter_document_version',
        ]);
      },
    );

    it(
      'fails closed on an unknown scope mode',
      () => {
        expect(
          () =>
            retrievalSourceKindsForScope(
              scope(
                'future_untrusted_mode',
                null,
              ),
            ),
        ).toThrow(
          'legal_synthesis.scope_mode_unsupported',
        );
      },
    );

    it(
      'requires a Matter ID whenever Matter retrieval is enabled',
      () => {
        expect(
          () =>
            retrievalSourceKindsForScope(
              scope(
                'ghana_corpus_and_matter',
                null,
              ),
            ),
        ).toThrow(
          'legal_synthesis.matter_scope_missing',
        );
      },
    );

    it(
      'rejects a Matter ID in a non-Matter scope',
      () => {
        expect(
          () =>
            retrievalSourceKindsForScope(
              scope(
                'ghana_corpus',
                '00000000-0000-4000-8000-000000000099',
              ),
            ),
        ).toThrow(
          'legal_synthesis.matter_scope_unexpected',
        );
      },
    );

    it(
      'fails closed outside Ghana',
      () => {
        expect(
          () =>
            retrievalSourceKindsForScope({
              ...scope(
                'ghana_corpus',
                null,
              ),

              countryCode:
                'NG',
            } as never),
        ).toThrow(
          'legal_synthesis.jurisdiction_not_supported',
        );
      },
    );
  },
);
