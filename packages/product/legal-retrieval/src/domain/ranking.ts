import type {
  RetrievalEvidence,
} from './retrieval.js';

function evidenceIdentity(
  evidence: RetrievalEvidence,
): string {
  return [
    evidence.source.kind,
    evidence.source.sourceId,
    evidence.source.versionId,
    evidence.passage?.passageId ?? '',
  ].join(':');
}

/**
 * Deterministic Phase 8 ranking.
 *
 * Security/rights filtering happens BEFORE this function. Ranking must never
 * be used as an authorization mechanism.
 */
export function rankRetrievalEvidence(
  input: readonly RetrievalEvidence[],
  limit: number,
): readonly RetrievalEvidence[] {
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
  ) {
    throw new Error(
      'retrieval.rank_limit_invalid',
    );
  }

  const deduplicated =
    new Map<string, RetrievalEvidence>();

  for (const evidence of input) {
    if (
      !Number.isFinite(evidence.score)
    ) {
      throw new Error(
        'retrieval.score_invalid',
      );
    }

    const identity =
      evidenceIdentity(evidence);

    const existing =
      deduplicated.get(identity);

    if (
      existing === undefined
      || evidence.score > existing.score
      || (
        evidence.score === existing.score
        && evidence.stableKey
          < existing.stableKey
      )
    ) {
      deduplicated.set(
        identity,
        evidence,
      );
    }
  }

  return Object.freeze(
    [...deduplicated.values()]
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        const stable =
          left.stableKey.localeCompare(
            right.stableKey,
            'en',
          );

        if (stable !== 0) {
          return stable;
        }

        return evidenceIdentity(left)
          .localeCompare(
            evidenceIdentity(right),
            'en',
          );
      })
      .slice(0, limit),
  );
}
