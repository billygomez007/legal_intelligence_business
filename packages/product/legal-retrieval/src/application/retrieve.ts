import {
  rankRetrievalEvidence,
} from '../domain/ranking.js';

import {
  prepareRetrievalQuery,
} from '../domain/query.js';

import type {
  AuthorizedRetrievalScope,
  RetrievalResult,
} from '../domain/retrieval.js';

import type {
  RetrievalSourcePort,
} from '../ports/retrieval-source.js';

export async function retrieveLegalEvidence(
  input: {
    readonly scope: AuthorizedRetrievalScope;
    readonly query: string;
    readonly limit?: number;
    readonly sources: readonly RetrievalSourcePort[];
  },
): Promise<RetrievalResult> {
  if (
    input.scope.countryCode !== 'GH'
  ) {
    throw new Error(
      'retrieval.jurisdiction_not_supported',
    );
  }

  if (
    !Number.isSafeInteger(
      input.scope.taskScopeRevision,
    )
    || input.scope.taskScopeRevision < 1
  ) {
    throw new Error(
      'retrieval.task_scope_revision_invalid',
    );
  }

  const query = prepareRetrievalQuery(
    input.limit === undefined
      ? {
          text: input.query,
        }
      : {
          text: input.query,
          limit: input.limit,
        },
  );

  const eligible = await Promise.all(
    input.sources.map(
      (source) =>
        source.search(
          input.scope,
          query,
        ),
    ),
  );

  const evidence =
    rankRetrievalEvidence(
      eligible.flat(),
      query.limit,
    );

  return Object.freeze({
    scope: Object.freeze({
      ...input.scope,
    }),
    query,
    evidence,
  });
}
