import { forbidden } from '@legalintel/kernel';

export const LIFECYCLE_STATES = [
  'ingesting',
  'pending_review',
  'approved',
  'published',
  'withdrawn',
  'rejected',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Which database role performs a transition. Ingestion proposes; data-ops decides. */
export type TransitionActor = 'ingest' | 'dataops';

interface Transition {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly actor: TransitionActor;
}

/**
 * The legal moves. `corpus.lifecycle_transitions` in the database holds the same pairs and a
 * parity test asserts they are equal; the row-level-security policies encode the same actor
 * split (ingest can reach `pending_review` and `rejected`; data-ops the rest).
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'ingesting', to: 'pending_review', actor: 'ingest' },
  { from: 'ingesting', to: 'rejected', actor: 'ingest' },
  { from: 'pending_review', to: 'approved', actor: 'dataops' },
  { from: 'pending_review', to: 'rejected', actor: 'dataops' },
  { from: 'approved', to: 'published', actor: 'dataops' },
  { from: 'approved', to: 'rejected', actor: 'dataops' },
  { from: 'published', to: 'withdrawn', actor: 'dataops' },
];

export const canTransition = (from: LifecycleState, to: LifecycleState): boolean =>
  TRANSITIONS.some((t) => t.from === from && t.to === to);

export function actorFor(from: LifecycleState, to: LifecycleState): TransitionActor | null {
  return TRANSITIONS.find((t) => t.from === from && t.to === to)?.actor ?? null;
}

/** Only a published version is visible to end users. Everything else is internal. */
export const isVisibleToUsers = (state: LifecycleState): boolean => state === 'published';

/** Content and provenance are frozen once a version leaves `ingesting`. */
export const isEditable = (state: LifecycleState): boolean => state === 'ingesting';

/**
 * Two-person rule: whoever approved a version cannot also publish it. Also a database CHECK;
 * this lets callers fail early with a clear error instead of a constraint violation.
 */
export function assertTwoPerson(approvedBy: string, publishedBy: string): void {
  if (approvedBy === publishedBy) {
    throw forbidden(
      'corpus.two_person_rule',
      'The person who approved a version cannot also publish it.',
    );
  }
}
