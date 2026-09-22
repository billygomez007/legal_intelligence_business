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

interface PrivateCandidateRow {
  readonly source_id: string;
  readonly version_id: string;
  readonly passage_id: string;
  readonly locator: string | null;
  readonly content_hash: string;
  readonly score: number | string;
  readonly stable_key: string;
  readonly excerpt: string;
}

function mapRows(
  rows: readonly PrivateCandidateRow[],
  sourceKind: Exclude<
    RetrievalSourceKind,
    'corpus_document_version'
  >,
): readonly RetrievalCandidate[] {
  const candidates: RetrievalCandidate[] = [];

  for (const row of rows) {
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
        sourceKind,
        sourceId: row.source_id,
        versionId: row.version_id,
        passageId: row.passage_id,
        locator: row.locator,
        contentHash: row.content_hash,
        score,
        stableKey: row.stable_key,
        excerpt: row.excerpt,
      }),
    );
  }

  return Object.freeze(candidates);
}

/**
 * PostgreSQL full-text candidate retrieval for private tenant data.
 *
 * The transaction must already be tenant scoped. PostgreSQL FORCE RLS remains
 * the hard organization boundary.
 *
 * Candidate eligibility is deliberately narrow before ranking:
 *
 * Firm Knowledge
 * - current organization only through RLS/app.current_org_id()
 * - active source only
 * - exact immutable source version
 *
 * Matter Documents
 * - current organization only through RLS/app.current_org_id()
 * - exact task matter only
 * - active document only
 * - exact immutable document version
 *
 * The Phase 7 source reader still reauthorizes every returned exact reference
 * before Phase 8 exposes it as retrieval evidence.
 */
export class PgPrivateRetrievalCandidateStore
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
    if (scope.countryCode !== 'GH') {
      return [];
    }

    if (
      sourceKind ===
      'knowledge_source_version'
    ) {
      return this.searchKnowledge(
        query,
      );
    }

    if (
      sourceKind ===
      'matter_document_version'
    ) {
      if (scope.matterId === null) {
        return [];
      }

      return this.searchMatter(
        query,
        scope.matterId,
      );
    }

    return [];
  }

  private async searchKnowledge(
    query: RetrievalQuery,
  ): Promise<readonly RetrievalCandidate[]> {
    const result =
      await this.tx.query<PrivateCandidateRow>(
        `
          WITH search_query AS (
            SELECT websearch_to_tsquery(
              'simple',
              $1::text
            ) AS query
          )
          SELECT
            s.id::text AS source_id,
            sv.id::text AS version_id,
            p.id::text AS passage_id,
            p.locator,
            p.text_sha256 AS content_hash,
            ts_rank_cd(
              p.search_vector,
              search_query.query
            )::float8 AS score,
            p.id::text AS stable_key,
            p.text AS excerpt
          FROM knowledge.passages AS p
          JOIN knowledge.source_versions AS sv
            ON sv.organization_id =
               p.organization_id
           AND sv.source_id =
               p.source_id
           AND sv.id =
               p.version_id
          JOIN knowledge.sources AS s
            ON s.organization_id =
               p.organization_id
           AND s.id =
               p.source_id
          CROSS JOIN search_query
          WHERE
            p.organization_id =
              app.current_org_id()
            AND s.status =
              'active'
            AND p.search_vector
              @@ search_query.query
          ORDER BY
            score DESC,
            p.id ASC
          LIMIT $2
        `,
        [
          query.normalizedText,
          query.limit,
        ],
      );

    return mapRows(
      result.rows,
      'knowledge_source_version',
    );
  }

  private async searchMatter(
    query: RetrievalQuery,
    matterId: string,
  ): Promise<readonly RetrievalCandidate[]> {
    const result =
      await this.tx.query<PrivateCandidateRow>(
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
            p.text_sha256 AS content_hash,
            ts_rank_cd(
              p.search_vector,
              search_query.query
            )::float8 AS score,
            p.id::text AS stable_key,
            p.text AS excerpt
          FROM matter_documents.passages AS p
          JOIN matter_documents.document_versions AS dv
            ON dv.organization_id =
               p.organization_id
           AND dv.matter_id =
               p.matter_id
           AND dv.document_id =
               p.document_id
           AND dv.id =
               p.version_id
          JOIN matter_documents.documents AS d
            ON d.organization_id =
               p.organization_id
           AND d.matter_id =
               p.matter_id
           AND d.id =
               p.document_id
          CROSS JOIN search_query
          WHERE
            p.organization_id =
              app.current_org_id()
            AND p.matter_id =
              $2::uuid
            AND d.status =
              'active'
            AND p.search_vector
              @@ search_query.query
          ORDER BY
            score DESC,
            p.id ASC
          LIMIT $3
        `,
        [
          query.normalizedText,
          matterId,
          query.limit,
        ],
      );

    return mapRows(
      result.rows,
      'matter_document_version',
    );
  }
}
