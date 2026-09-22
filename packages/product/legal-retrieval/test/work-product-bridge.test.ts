import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  RetrievalEvidence,
  RetrievalResult,
} from '../src/domain/retrieval.js';

import {
  retrievalEvidenceToWorkProductProvenance,
  retrievalResultToWorkProductProvenance,
} from '../src/index.js';

function evidence(
  kind:
    RetrievalEvidence['source']['kind'],
  sourceId: string,
  versionId: string,
  passageId: string,
  locator: string | null,
  excerpt:
    string = 'SYNTHETIC confidential evidence',
): RetrievalEvidence {
  return Object.freeze({
    source: Object.freeze({
      kind,
      sourceId,
      versionId,
    }),

    passage: Object.freeze({
      passageId,
      locator,
      excerpt,
      contentHash:
        'a'.repeat(64),
    }),

    excerpt,

    score:
      0.8,

    stableKey:
      passageId,
  });
}

describe(
  'retrieval -> Work Product provenance bridge',
  () => {
    it(
      'preserves exact source, version and locator identities',
      () => {
        const result =
          retrievalEvidenceToWorkProductProvenance([
            evidence(
              'corpus_document_version',
              'document-1',
              'version-1',
              'passage-1',
              'paragraph:4',
            ),

            evidence(
              'knowledge_source_version',
              'knowledge-1',
              'knowledge-version-1',
              'passage-2',
              'page:2/paragraph:7',
            ),

            evidence(
              'matter_document_version',
              'matter-document-1',
              'matter-version-1',
              'passage-3',
              null,
            ),
          ]);

        expect(result).toEqual([
          {
            kind:
              'corpus_document_version',
            sourceId:
              'document-1',
            versionId:
              'version-1',
            locator:
              'paragraph:4',
          },

          {
            kind:
              'knowledge_source_version',
            sourceId:
              'knowledge-1',
            versionId:
              'knowledge-version-1',
            locator:
              'page:2/paragraph:7',
          },

          {
            kind:
              'matter_document_version',
            sourceId:
              'matter-document-1',
            versionId:
              'matter-version-1',
            locator:
              null,
          },
        ]);
      },
    );

    it(
      'does not persist excerpts, scores, hashes or passage ids as provenance',
      () => {
        const source =
          evidence(
            'knowledge_source_version',
            'knowledge-1',
            'version-1',
            'private-passage-id',
            'page:1',
            'VERY PRIVATE TEXT',
          );

        const result =
          retrievalEvidenceToWorkProductProvenance([
            source,
          ]);

        const serialized =
          JSON.stringify(result);

        expect(serialized)
          .not.toContain(
            'VERY PRIVATE TEXT',
          );

        expect(serialized)
          .not.toContain(
            'private-passage-id',
          );

        expect(serialized)
          .not.toContain(
            '0.8',
          );

        expect(serialized)
          .not.toContain(
            'a'.repeat(64),
          );
      },
    );

    it(
      'deduplicates identical exact provenance references deterministically',
      () => {
        const first =
          evidence(
            'corpus_document_version',
            'document-1',
            'version-1',
            'passage-1',
            'paragraph:4',
          );

        const second =
          evidence(
            'corpus_document_version',
            'document-1',
            'version-1',
            'passage-2',
            'paragraph:4',
          );

        expect(
          retrievalEvidenceToWorkProductProvenance([
            first,
            second,
          ]),
        ).toHaveLength(1);
      },
    );

    it(
      'accepts a complete RetrievalResult',
      () => {
        const item =
          evidence(
            'matter_document_version',
            'document-1',
            'version-1',
            'passage-1',
            'page:3',
          );

        const result = {
          scope: {
            organizationId:
              'org-A',
            taskId:
              'task-A',
            taskScopeRevision:
              1,
            jurisdictionId:
              'jurisdiction-GH',
            countryCode:
              'GH',
            matterId:
              'matter-A',
            scopeMode:
              'ghana_corpus_and_matter',
          },

          query: {
            text:
              'contract',
            normalizedText:
              'contract',
            fingerprint:
              'b'.repeat(64),
            limit:
              10,
          },

          evidence: [
            item,
          ],
        } as RetrievalResult;

        expect(
          retrievalResultToWorkProductProvenance(
            result,
          ),
        ).toEqual([
          {
            kind:
              'matter_document_version',
            sourceId:
              'document-1',
            versionId:
              'version-1',
            locator:
              'page:3',
          },
        ]);
      },
    );
  },
);
