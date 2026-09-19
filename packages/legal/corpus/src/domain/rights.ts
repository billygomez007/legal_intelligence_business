/**
 * Source rights (docs/18, docs/15: "API rights must never exceed the rights the platform has
 * to the underlying content"). Rights are DATA with a history, and every use is separate:
 * permission to display a judgment is not permission to feed it to a model or resell it.
 *
 * `effectiveDecision` mirrors the database function `corpus.source_allows` exactly, and a
 * parity test runs both against the same scenarios so they cannot drift apart.
 */
export const RIGHTS_USES = [
  'acquire_store',
  'display',
  'index_search',
  'ai_processing',
  'derive_metadata',
  'redistribute_api',
  'bulk_export',
] as const;
export type RightsUse = (typeof RIGHTS_USES)[number];

export const RIGHTS_STATUSES = ['approved', 'denied', 'revoked'] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export interface RightsDecision {
  readonly id: string;
  /** Strict insertion order in the ledger (`sequence` column). Later means more recent. */
  readonly sequence: number;
  readonly status: RightsStatus;
  readonly allowedUses: readonly RightsUse[];
  readonly decidedAt: Date;
  readonly effectiveFrom: Date;
  readonly expiresAt: Date | null;
}

/** What a caller is trying to do, mapped to the rights it requires. */
export type Purpose = 'display' | 'search' | 'ai' | 'api' | 'export';

export const PURPOSE_REQUIRES: Readonly<Record<Purpose, RightsUse>> = {
  display: 'display',
  search: 'index_search',
  ai: 'ai_processing',
  api: 'redistribute_api',
  export: 'bulk_export',
};

/** Publishing a version to end users needs both: it must be shown and it must be findable. */
export const USES_REQUIRED_TO_PUBLISH: readonly RightsUse[] = ['display', 'index_search'];

/**
 * The decision in force at `now`: among decisions that have taken effect, the LATEST in the
 * ledger's insertion order. A later revocation or denial therefore ends earlier approval, and
 * a future-dated decision does not yet displace the one in force. Order is by `sequence`, not
 * by timestamp: two decisions can share a clock reading, and JavaScript dates have only
 * millisecond precision where the database keeps microseconds.
 */
export function effectiveDecision(
  decisions: readonly RightsDecision[],
  now: Date,
): RightsDecision | null {
  let latest: RightsDecision | null = null;
  for (const decision of decisions) {
    if (decision.effectiveFrom > now) continue;
    if (latest === null || decision.sequence > latest.sequence) latest = decision;
  }
  return latest;
}

export function allows(decisions: readonly RightsDecision[], use: RightsUse, now: Date): boolean {
  const decision = effectiveDecision(decisions, now);
  if (decision === null) return false;
  if (decision.status !== 'approved') return false;
  if (decision.expiresAt !== null && decision.expiresAt <= now) return false;
  return decision.allowedUses.includes(use);
}

export const allowsPurpose = (
  decisions: readonly RightsDecision[],
  purpose: Purpose,
  now: Date,
): boolean => allows(decisions, PURPOSE_REQUIRES[purpose], now);

export const canPublish = (decisions: readonly RightsDecision[], now: Date): boolean =>
  USES_REQUIRED_TO_PUBLISH.every((use) => allows(decisions, use, now));
