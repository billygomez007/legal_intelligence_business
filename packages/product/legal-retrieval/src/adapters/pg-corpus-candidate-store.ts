import type { Tx } from '@legalintel/db';

import type {
  AuthorizedRetrievalScope,
  RetrievalQuery,
  RetrievalSourceKind,
} from '../domain/retrieval.js';

import type {
  RetrievalCandidate,
  RetrievalCandidateStore,
} from '../ports/retrieval-candidate-store.js';

interface CorpusCandidateRow {
  readonly source_id: string;
  readonly version_id: string;
  readonly passage_id: string;
  readonly locator: string | null;
  readonly score: number | string;
  readonly stable_key: string;
  readonly excerpt: string;
}

/**
 * PostgreSQL lexical retrieval over the published Ghana legal corpus.
 *
 * Important:
 *
 * - source_id returned to Phase 8 is the stable LEGAL DOCUMENT id.
 * - version_id is the exact immutable corpus document version.
 * - corpus rights are checked against document_versions.source_id, because
 *   that identifies the acquisition/publisher source governed by the rights
 *   ledger.
 * - only currently published versions with current ai_processing rights are
 *   eligible.
 * - ranking occurs only after jurisdiction/lifecycle/rights eligibility.
 */
export class PgCorpusRetrievalCandidateStore
  implements RetrievalCandidateStore
{
  constructor(
    private readonly tx: Tx,
  ) {}

  async searchCandidates(
    scope: AuthorizedRetrievalScope,
    query: RetrievalQuery,
    sourceKind: RetrievalSourceKind,
  ): Promise<readonly RetrievalCandidate[]> {
    if (
      sourceKind !== 'corpus_document_version'
      || scope.countryCode !== 'GH'
    ) {
      return [];
    }

    const result =
      await this.tx.query<CorpusCandidateRow>(
        `
          WITH search_query AS (
            SELECT websearch_to_tsquery(
              'simple',
              $1::text
            ) AS query
          )
          SELECT
            d.id::text AS source_id,
            dv.id::text AS version_id,
            p.id::text AS passage_id,
            p.locator,
            ts_rank_cd(
              to_tsvector(
                'simple',
                p.text
              ),
              search_query.query
            )::float8 AS score,
            p.id::text AS stable_key,
            p.text AS excerpt
          FROM corpus.passages AS p
          JOIN corpus.document_versions AS dv
            ON dv.id = p.version_id
          JOIN corpus.legal_documents AS d
            ON d.id = dv.document_id
          CROSS JOIN search_query
          WHERE dv.jurisdiction_id = $2::uuid
            AND d.jurisdiction_id = $2::uuid
            AND dv.lifecycle_state = 'published'
            AND corpus.source_allows(
              dv.source_id,
              'ai_processing'
            )
            AND to_tsvector(
              'simple',
              p.text
            ) @@ search_query.query
          ORDER BY
            score DESC,
            p.id ASC
          LIMIT $3
        `,
        [
          query.normalizedText,
          scope.jurisdictionId,
          query.limit,
        ],
      );

    const candidates:
      RetrievalCandidate[] = [];

    for (const row of result.rows) {
      const score =
        typeof row.score === 'number'
          ? row.score
          : Number(row.score);

      if (
        !Number.isFinite(score)
        || score < 0
      ) {
        continue;
      }

      candidates.push(
        Object.freeze({
          sourceKind:
            'corpus_document_version',

          sourceId:
            row.source_id,

          versionId:
            row.version_id,

          passageId:
            row.passage_id,

          locator:
            row.locator,

          contentHash:
            null,

          score,

          stableKey:
            row.stable_key,

          excerpt:
            row.excerpt,
        }),
      );
    }

    return Object.freeze(candidates);
  }
}
