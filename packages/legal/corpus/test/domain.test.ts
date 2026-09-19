import { describe, expect, it } from 'vitest';

import {
  LIFECYCLE_STATES,
  PURPOSE_REQUIRES,
  RELATIONSHIPS,
  RIGHTS_USES,
  TRANSITIONS,
  actorFor,
  allows,
  allowsPurpose,
  assertTwoPerson,
  binds,
  canPublish,
  canTransition,
  effectiveDecision,
  isEditable,
  isPersuasive,
  isShownToUsers,
  isVisibleToUsers,
  type RightsDecision,
} from '../src';

const at = (offsetDays: number) => new Date(Date.UTC(2026, 0, 15) + offsetDays * 86_400_000);
const NOW = at(0);

let counter = 0;
const decision = (
  over: Partial<RightsDecision> & Pick<RightsDecision, 'status'>,
): RightsDecision => ({
  id: `d-${String((counter += 1)).padStart(3, '0')}`,
  sequence: counter,
  allowedUses: over.status === 'approved' ? ['display', 'index_search'] : [],
  decidedAt: at(-10),
  effectiveFrom: at(-10),
  expiresAt: null,
  ...over,
});

describe('rights', () => {
  it('allows nothing when there is no decision: technically accessible is not approved', () => {
    for (const use of RIGHTS_USES) expect(allows([], use, NOW)).toBe(false);
    expect(effectiveDecision([], NOW)).toBeNull();
  });

  it('allows exactly the uses an approval names, and no others', () => {
    const decisions = [decision({ status: 'approved', allowedUses: ['display', 'index_search'] })];
    expect(allows(decisions, 'display', NOW)).toBe(true);
    expect(allows(decisions, 'index_search', NOW)).toBe(true);
    expect(allows(decisions, 'ai_processing', NOW)).toBe(false);
    expect(allows(decisions, 'redistribute_api', NOW)).toBe(false);
    expect(allows(decisions, 'bulk_export', NOW)).toBe(false);
  });

  it('lets the latest decision in the ledger win: a later revocation ends an earlier approval', () => {
    const approved = decision({ status: 'approved' });
    const revoked = decision({ status: 'revoked' });
    expect(allows([approved, revoked], 'display', NOW)).toBe(false);
    expect(allows([revoked, approved], 'display', NOW)).toBe(false); // list order is irrelevant
  });

  it('lets a later re-approval restore access', () => {
    const decisions = [
      decision({ status: 'approved' }),
      decision({ status: 'revoked' }),
      decision({ status: 'approved' }),
    ];
    expect(allows(decisions, 'display', NOW)).toBe(true);
  });

  it('does not let a future-dated decision displace the one in force', () => {
    const inForce = decision({ status: 'approved', effectiveFrom: at(-10) });
    const scheduledRevocation = decision({ status: 'revoked', effectiveFrom: at(5) });
    expect(allows([inForce, scheduledRevocation], 'display', NOW)).toBe(true);
    expect(allows([inForce, scheduledRevocation], 'display', at(6))).toBe(false);
  });

  it('ends at expiry', () => {
    const expiring = decision({ status: 'approved', expiresAt: at(3) });
    expect(allows([expiring], 'display', at(2))).toBe(true);
    expect(allows([expiring], 'display', at(3))).toBe(false);
    expect(allows([expiring], 'display', at(4))).toBe(false);
  });

  it('treats a denial as no access', () => {
    expect(allows([decision({ status: 'denied' })], 'display', NOW)).toBe(false);
  });

  it('orders by ledger sequence, never by timestamp, so clock readings cannot decide access', () => {
    // The revocation carries an EARLIER timestamp (clock skew, or a shared millisecond) but a
    // later place in the ledger. It must still win.
    const approved = decision({ status: 'approved', decidedAt: at(-1) });
    const revoked = decision({ status: 'revoked', decidedAt: at(-30) });
    expect(revoked.sequence).toBeGreaterThan(approved.sequence);
    expect(effectiveDecision([approved, revoked], NOW)?.status).toBe('revoked');
    expect(allows([approved, revoked], 'display', NOW)).toBe(false);
  });

  describe('purposes (docs/15: API rights never exceed content rights)', () => {
    it('map each purpose to a distinct required use', () => {
      expect(PURPOSE_REQUIRES).toEqual({
        display: 'display',
        search: 'index_search',
        ai: 'ai_processing',
        api: 'redistribute_api',
        export: 'bulk_export',
      });
    });

    it('keep content out of AI and the API unless those uses were separately approved', () => {
      const displayOnly = [
        decision({ status: 'approved', allowedUses: ['display', 'index_search'] }),
      ];
      expect(allowsPurpose(displayOnly, 'search', NOW)).toBe(true);
      expect(allowsPurpose(displayOnly, 'ai', NOW)).toBe(false);
      expect(allowsPurpose(displayOnly, 'api', NOW)).toBe(false);
    });
  });

  describe('publication', () => {
    it('needs both display and search', () => {
      expect(
        canPublish(
          [decision({ status: 'approved', allowedUses: ['display', 'index_search'] })],
          NOW,
        ),
      ).toBe(true);
      expect(canPublish([decision({ status: 'approved', allowedUses: ['display'] })], NOW)).toBe(
        false,
      );
      expect(
        canPublish([decision({ status: 'approved', allowedUses: ['index_search'] })], NOW),
      ).toBe(false);
      expect(
        canPublish([decision({ status: 'approved', allowedUses: ['ai_processing'] })], NOW),
      ).toBe(false);
      expect(canPublish([], NOW)).toBe(false);
    });
  });
});

describe('lifecycle', () => {
  it('defines only moves between known states, with no self-loops', () => {
    for (const t of TRANSITIONS) {
      expect(LIFECYCLE_STATES).toContain(t.from);
      expect(LIFECYCLE_STATES).toContain(t.to);
      expect(t.from).not.toBe(t.to);
    }
  });

  it('allows the review path and nothing else', () => {
    expect(canTransition('ingesting', 'pending_review')).toBe(true);
    expect(canTransition('pending_review', 'approved')).toBe(true);
    expect(canTransition('approved', 'published')).toBe(true);
    expect(canTransition('published', 'withdrawn')).toBe(true);

    expect(canTransition('ingesting', 'published')).toBe(false); // cannot skip review
    expect(canTransition('ingesting', 'approved')).toBe(false);
    expect(canTransition('pending_review', 'published')).toBe(false);
  });

  it('has no way out of terminal states, so withdrawn and rejected content cannot reappear', () => {
    for (const terminal of ['withdrawn', 'rejected'] as const) {
      for (const to of LIFECYCLE_STATES)
        expect(canTransition(terminal, to), `${terminal} -> ${to}`).toBe(false);
    }
  });

  it('gives ingestion no power to approve or publish (separation of duties)', () => {
    for (const t of TRANSITIONS.filter((x) => x.actor === 'ingest')) {
      expect(['pending_review', 'rejected']).toContain(t.to);
    }
    expect(actorFor('pending_review', 'approved')).toBe('dataops');
    expect(actorFor('approved', 'published')).toBe('dataops');
    expect(actorFor('ingesting', 'published')).toBeNull();
  });

  it('shows only published versions to users, and freezes everything after ingestion', () => {
    expect(LIFECYCLE_STATES.filter(isVisibleToUsers)).toEqual(['published']);
    expect(LIFECYCLE_STATES.filter(isEditable)).toEqual(['ingesting']);
  });

  it('enforces the two-person rule', () => {
    expect(() => {
      assertTwoPerson('alice', 'bob');
    }).not.toThrow();
    expect(() => {
      assertTwoPerson('alice', 'alice');
    }).toThrow(expect.objectContaining({ code: 'corpus.two_person_rule' }) as Error);
  });
});

describe('court authority', () => {
  const supreme = { jurisdictionId: 'GH', authorityRank: 1 };
  const appeal = { jurisdictionId: 'GH', authorityRank: 2 };
  const appeal2 = { jurisdictionId: 'GH', authorityRank: 2 };
  const foreign = { jurisdictionId: 'XX', authorityRank: 1 };

  it('binds lower courts in the same jurisdiction, and never upward or sideways', () => {
    expect(binds(supreme, appeal)).toBe(true);
    expect(binds(appeal, supreme)).toBe(false);
    expect(binds(appeal, appeal2)).toBe(false);
    expect(binds(supreme, supreme)).toBe(false);
  });

  it('treats equal-rank decisions in one jurisdiction as persuasive', () => {
    expect(isPersuasive(appeal, appeal2)).toBe(true);
    expect(isPersuasive(supreme, appeal)).toBe(false);
  });

  it('never lets authority cross jurisdictions', () => {
    expect(binds(foreign, appeal)).toBe(false);
    expect(binds(supreme, { jurisdictionId: 'XX', authorityRank: 5 })).toBe(false);
    expect(isPersuasive(supreme, foreign)).toBe(false);
  });
});

describe('citation-graph relationships', () => {
  it('shows plain citations automatically but treatments only once a human has reviewed them', () => {
    expect(isShownToUsers('cites', 'unreviewed')).toBe(true);
    expect(isShownToUsers('mentions', 'unreviewed')).toBe(true);
    for (const { type, requiresReview } of RELATIONSHIPS.filter((r) => r.requiresReview)) {
      expect(isShownToUsers(type, 'unreviewed'), `${type} unreviewed`).toBe(false);
      expect(isShownToUsers(type, 'human_reviewed'), `${type} reviewed`).toBe(true);
      expect(requiresReview).toBe(true);
    }
  });

  it('never shows a rejected edge', () => {
    for (const { type } of RELATIONSHIPS) expect(isShownToUsers(type, 'rejected')).toBe(false);
  });

  it('treats the outcome-changing relationships as requiring review', () => {
    for (const type of [
      'overruled',
      'distinguished',
      'followed',
      'questioned',
      'repeals',
      'amends',
    ] as const) {
      expect(RELATIONSHIPS.find((r) => r.type === type)?.requiresReview, type).toBe(true);
    }
  });
});
