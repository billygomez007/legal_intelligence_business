/**
 * Citation-graph edge types (docs/13). "The graph must never imply a legal relationship that
 * cannot be traced to evidence", and high-impact treatments (a case being *overruled* or
 * *distinguished*) must be human-reviewed before a user is shown them (docs/19). Plain
 * citation and mention edges are factual and shown automatically.
 *
 * `graph.relationship_types` holds the same table; a parity test asserts equality.
 */
export const RELATIONSHIPS = [
  { type: 'cites', requiresReview: false },
  { type: 'mentions', requiresReview: false },
  { type: 'followed', requiresReview: true },
  { type: 'applied', requiresReview: true },
  { type: 'distinguished', requiresReview: true },
  { type: 'questioned', requiresReview: true },
  { type: 'overruled', requiresReview: true },
  { type: 'interprets', requiresReview: true },
  { type: 'applies_provision', requiresReview: true },
  { type: 'amends', requiresReview: true },
  { type: 'repeals', requiresReview: true },
  { type: 'supersedes', requiresReview: true },
] as const;

export type RelationshipType = (typeof RELATIONSHIPS)[number]['type'];
export type ReviewStatus = 'unreviewed' | 'human_reviewed' | 'rejected';

export function isShownToUsers(type: RelationshipType, review: ReviewStatus): boolean {
  if (review === 'rejected') return false;
  const definition = RELATIONSHIPS.find((r) => r.type === type);
  return definition !== undefined && (!definition.requiresReview || review === 'human_reviewed');
}
