import type {
  WorkProductSourceReference,
} from '@legalintel/work-products';

import type {
  RetrievalEvidence,
  RetrievalResult,
} from '../domain/retrieval.js';

function evidenceReference(
  evidence: RetrievalEvidence,
): WorkProductSourceReference {
  return Object.freeze({
    kind: evidence.source.kind,
    sourceId: evidence.source.sourceId,
    versionId: evidence.source.versionId,
    locator: evidence.passage?.locator ?? null,
  });
}

/**
 * Convert already-authorized retrieval evidence into exact immutable Work
 * Product provenance references.
 *
 * Important:
 *
 * This conversion is NOT permanent authorization.
 *
 * appendPersistentWorkProductRevision /
 * prepareWorkProductContentRevision must re-read the current task scope and
 * reauthorize every exact source/version again immediately before persistence.
 *
 * That second authorization boundary is what prevents stale retrieval results
 * from becoming durable provenance after:
 *
 * - corpus ai_processing rights are removed or revoked;
 * - Firm Knowledge is archived;
 * - Matter Documents are archived;
 * - the task scope revision changes;
 * - a matter boundary changes;
 * - the task becomes unavailable.
 */
export function retrievalEvidenceToWorkProductProvenance(
  evidence: readonly RetrievalEvidence[],
): readonly WorkProductSourceReference[] {
  const seen =
    new Set<string>();

  const references:
    WorkProductSourceReference[] = [];

  for (
    const item
    of evidence
  ) {
    const reference =
      evidenceReference(item);

    const key =
      JSON.stringify([
        reference.kind,
        reference.sourceId,
        reference.versionId,
        reference.locator,
      ]);

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    references.push(
      reference,
    );
  }

  return Object.freeze(
    references,
  );
}

/**
 * Convenience form for a complete RetrievalResult.
 *
 * No query text, excerpt, rank or score crosses the persistence boundary.
 * Only exact source/version/locator provenance is retained.
 */
export function retrievalResultToWorkProductProvenance(
  result: RetrievalResult,
): readonly WorkProductSourceReference[] {
  return retrievalEvidenceToWorkProductProvenance(
    result.evidence,
  );
}
