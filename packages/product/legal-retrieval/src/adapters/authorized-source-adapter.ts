import type { AuthzContext } from '@legalintel/iam';

import type {
  WorkProductRevisionSourceReader,
  WorkProductScopeAuthorization,
  WorkProductSourceReference,
} from '@legalintel/work-products';

import type {
  AuthorizedRetrievalScope,
  RetrievalEvidence,
  RetrievalQuery,
  RetrievalSourceKind,
} from '../domain/retrieval.js';

import type {
  RetrievalCandidateStore,
} from '../ports/retrieval-candidate-store.js';

import type {
  RetrievalSourcePort,
} from '../ports/retrieval-source.js';

export interface AuthorizedRetrievalSourceDependencies {
  readonly context: AuthzContext;
  readonly sourceReader: WorkProductRevisionSourceReader;
  readonly candidateStore: RetrievalCandidateStore;
}

function toWorkProductScope(
  scope: AuthorizedRetrievalScope,
): WorkProductScopeAuthorization {
  return {
    organizationId: scope.organizationId,
    taskId: scope.taskId,
    taskScopeRevision: scope.taskScopeRevision,
    matterId: scope.matterId,
    countryCode: 'GH',
    taskStatus: 'ready',
    permitted: true,
  };
}

function toReference(
  kind: RetrievalSourceKind,
  candidate: {
    readonly sourceId: string;
    readonly versionId: string;
    readonly locator: string | null;
  },
): WorkProductSourceReference {
  return {
    kind,
    sourceId: candidate.sourceId,
    versionId: candidate.versionId,
    locator: candidate.locator,
  };
}

export function createAuthorizedRetrievalSource(
  kind: RetrievalSourceKind,
  dependencies: AuthorizedRetrievalSourceDependencies,
): RetrievalSourcePort {
  return Object.freeze({
    kind,

    async search(
      scope: AuthorizedRetrievalScope,
      query: RetrievalQuery,
    ): Promise<readonly RetrievalEvidence[]> {
      if (scope.countryCode !== 'GH') {
        return [];
      }

      const candidates =
        await dependencies.candidateStore.searchCandidates(
          scope,
          query,
          kind,
        );

      const authorized: RetrievalEvidence[] = [];
      const phase7Scope = toWorkProductScope(scope);

      for (const candidate of candidates) {
        if (
          candidate.sourceKind !== kind
          || !Number.isFinite(candidate.score)
        ) {
          continue;
        }

        const reference = toReference(
          kind,
          candidate,
        );

        const allowed =
          await dependencies.sourceReader.readSource(
            dependencies.context,
            phase7Scope,
            reference,
          );

        if (
          allowed === null
          || allowed.permitted !== true
          || allowed.kind !== kind
          || allowed.sourceId !== candidate.sourceId
          || allowed.versionId !== candidate.versionId
        ) {
          continue;
        }

        authorized.push(
          Object.freeze({
            source: Object.freeze({
              kind,
              sourceId: candidate.sourceId,
              versionId: candidate.versionId,
            }),

            passage:
              candidate.passageId === null
                ? null
                : Object.freeze({
                    passageId: candidate.passageId,
                    locator: candidate.locator,
                    contentHash: candidate.contentHash,
                  }),

            score: candidate.score,
            stableKey: candidate.stableKey,
            excerpt: candidate.excerpt,
          }),
        );
      }

      return Object.freeze(authorized);
    },
  });
}
