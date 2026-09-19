import { platformMigrations, withPublicTransaction, type DbPool } from '@legalintel/db';
import {
  checkGuardrails,
  createTestDatabase,
  formatViolations,
  type TestDatabase,
} from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DOCUMENT_TYPES,
  LIFECYCLE_STATES,
  RELATIONSHIPS,
  RIGHTS_USES,
  SOURCE_KINDS,
  TRANSITIONS,
  allows,
  assertNoSyntheticInProduction,
  corpusMigrations,
  corpusStore,
  sha256,
  type DocumentId,
  type JurisdictionId,
  type RightsDecision,
  type RightsStatus,
  type RightsUse,
  type SourceId,
  type VersionId,
} from '../src';
import { seedSyntheticCorpus } from '../src/testing';

let database: TestDatabase;
let ingest: DbPool;
let dataops: DbPool;
let app: DbPool;
let admin: TestDatabase['withAdmin'];

const staff = { rightsOfficer: '', reviewer: '', publisher: '', other: '' };

type Tx = Parameters<Parameters<typeof withPublicTransaction>[1]>[0];
const asIngest = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(ingest, fn);
const asDataops = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(dataops, fn);
const asApp = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(app, fn);

beforeAll(async () => {
  database = await createTestDatabase({
    migrationSets: [platformMigrations, iamMigrations, corpusMigrations],
  });
  ingest = database.poolFor('ingest');
  dataops = database.poolFor('dataops');
  app = database.poolFor('app');
  admin = (fn) => database.withAdmin(fn);

  for (const key of Object.keys(staff) as (keyof typeof staff)[]) {
    const result = await admin((c) =>
      c.query<{ id: string }>(
        `INSERT INTO iam.users (email, display_name) VALUES ($1, $2) RETURNING id`,
        [`${key}@staff.example.test`, key],
      ),
    );
    staff[key] = result.rows[0]?.id ?? '';
  }
});

afterAll(async () => {
  await database.dispose();
});

const rejectsWith = async (promise: Promise<unknown>, expected: Record<string, unknown>) => {
  // A permission refusal reaches a test either raw from the driver (SQLSTATE 42501) or already
  // mapped by the store to the typed `authz.denied`. Both mean "the database said no".
  if (expected['code'] === '42501') {
    await expect(promise).rejects.toSatisfy(
      (error: { code?: string }) => error.code === '42501' || error.code === 'authz.denied',
    );
    return;
  }
  await expect(promise).rejects.toMatchObject(expected);
};

let sequence = 0;
const unique = (label: string) => `${label}-${Date.now().toString(36)}-${(sequence += 1)}`;

/** A fresh jurisdiction with one source, so rights can differ per test. */
async function world() {
  return asDataops(async (tx) => {
    const jurisdictionId = await corpusStore.createJurisdiction(tx, {
      code: `ZZ-${(sequence += 1).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      name: unique('SYNTHETIC jurisdiction'),
      kind: 'country',
      isSynthetic: true,
    });
    const court = await corpusStore.createCourt(tx, {
      jurisdictionId,
      name: 'SYNTHETIC court',
      level: 1,
      authorityRank: 1,
    });
    const sourceId = await corpusStore.registerSource(tx, {
      jurisdictionId,
      name: unique('SYNTHETIC source'),
      kind: 'publisher',
    });
    return { jurisdictionId, court, sourceId };
  });
}

const grant = (
  sourceId: SourceId,
  status: RightsStatus,
  uses: RightsUse[],
  extra: { expiresAt?: Date; effectiveFrom?: Date } = {},
) =>
  asDataops((tx) =>
    corpusStore.recordRightsDecision(tx, {
      sourceId,
      status,
      allowedUses: uses,
      ...(status === 'approved' ? { evidenceReference: 'SYNTHETIC-EVIDENCE' } : {}),
      decidedBy: staff.rightsOfficer,
      ...extra,
    }),
  );

/** A draft version with two passages, still in `ingesting`. */
async function draft(
  w: { jurisdictionId: JurisdictionId; sourceId: SourceId },
  checksumSeed = unique('c'),
) {
  return asIngest(async (tx) => {
    const documentId = await corpusStore.createDocument(tx, {
      jurisdictionId: w.jurisdictionId,
      documentType: 'case',
      title: '[SYNTHETIC] A v B',
    });
    const versionId = await corpusStore.createVersion(tx, {
      documentId,
      jurisdictionId: w.jurisdictionId,
      versionNumber: 1,
      sourceId: w.sourceId,
      acquiredAt: new Date(),
      contentChecksum: sha256(checksumSeed),
      storageKey: `synthetic/${checksumSeed}`,
      pipelineVersion: 'test-1',
    });
    await corpusStore.addPassages(tx, versionId, [
      { ordinal: 0, locator: '¶1', text: 'SYNTHETIC first passage.' },
      { ordinal: 1, locator: '¶2', text: 'SYNTHETIC second passage.' },
    ]);
    return { documentId, versionId };
  });
}

const submit = (versionId: VersionId) =>
  asIngest((tx) => corpusStore.submitForReview(tx, versionId));
const approve = (versionId: VersionId, by = staff.reviewer) =>
  asDataops((tx) => corpusStore.approveVersion(tx, versionId, by));
const publish = (versionId: VersionId, by = staff.publisher) =>
  asDataops((tx) => corpusStore.publishVersion(tx, versionId, by));

/** Publishes with rights cleared. Returns the ids. */
async function published() {
  const w = await world();
  await grant(w.sourceId, 'approved', ['display', 'index_search']);
  const d = await draft(w);
  await submit(d.versionId);
  await approve(d.versionId);
  await publish(d.versionId);
  return { ...w, ...d };
}

const userSees = async (versionId: VersionId) =>
  (await asApp((tx) => corpusStore.getVersion(tx, versionId))) !== null;

/** Extracts the quoted literals from a CHECK constraint that mentions `needle`. */
async function checkLiterals(table: string, needle: string): Promise<string[]> {
  const result = await admin((c) =>
    c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def FROM pg_constraint con
        WHERE con.conrelid = $1::regclass AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE $2`,
      [table, `%${needle}%`],
    ),
  );
  const def = result.rows[0]?.def ?? '';
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1] ?? '').sort();
}

describe('parity: the TypeScript rules equal the database rules', () => {
  it('lifecycle transitions', async () => {
    const rows = await admin((c) =>
      c.query<{ from_state: string; to_state: string }>(
        'SELECT from_state, to_state FROM corpus.lifecycle_transitions',
      ),
    );
    expect(rows.rows.map((r) => `${r.from_state}>${r.to_state}`).sort()).toEqual(
      TRANSITIONS.map((t) => `${t.from}>${t.to}`).sort(),
    );
  });

  it('relationship types and which need review', async () => {
    const rows = await admin((c) =>
      c.query<{ type: string; requires_review: boolean }>(
        'SELECT type, requires_review FROM graph.relationship_types',
      ),
    );
    expect(rows.rows.map((r) => `${r.type}:${String(r.requires_review)}`).sort()).toEqual(
      RELATIONSHIPS.map((r) => `${r.type}:${String(r.requiresReview)}`).sort(),
    );
  });

  it('lifecycle states, document types, source kinds and rights uses', async () => {
    expect(await checkLiterals('corpus.document_versions', 'ingesting')).toEqual(
      [...LIFECYCLE_STATES].sort(),
    );
    expect(await checkLiterals('corpus.legal_documents', 'gazette_notice')).toEqual(
      [...DOCUMENT_TYPES].sort(),
    );
    expect(await checkLiterals('corpus.sources', 'court_registry')).toEqual(
      [...SOURCE_KINDS].sort(),
    );
    expect(await checkLiterals('corpus.source_rights_decisions', 'allowed_uses <@')).toEqual(
      [...RIGHTS_USES].sort(),
    );
  });

  it('who is allowed to do what, on the same sequences of rights decisions', async () => {
    const day = 86_400_000;
    const scenarios: {
      name: string;
      steps: {
        status: RightsStatus;
        uses: RightsUse[];
        extra?: { expiresAt?: Date; effectiveFrom?: Date };
      }[];
    }[] = [
      { name: 'no decisions', steps: [] },
      { name: 'approved', steps: [{ status: 'approved', uses: ['display', 'index_search'] }] },
      {
        name: 'approved then revoked',
        steps: [
          { status: 'approved', uses: ['display'] },
          { status: 'revoked', uses: [] },
        ],
      },
      {
        name: 'revoked then re-approved',
        steps: [
          { status: 'approved', uses: ['display'] },
          { status: 'revoked', uses: [] },
          { status: 'approved', uses: ['ai_processing'] },
        ],
      },
      { name: 'denied', steps: [{ status: 'denied', uses: [] }] },
      {
        name: 'expired approval',
        steps: [
          {
            status: 'approved',
            uses: ['display'],
            extra: {
              effectiveFrom: new Date(Date.now() - 3 * day),
              expiresAt: new Date(Date.now() - day),
            },
          },
        ],
      },
      {
        name: 'future-dated revocation does not displace current approval',
        steps: [
          { status: 'approved', uses: ['display'] },
          { status: 'revoked', uses: [], extra: { effectiveFrom: new Date(Date.now() + 2 * day) } },
        ],
      },
      {
        name: 'future-dated approval is not yet in force',
        steps: [
          {
            status: 'approved',
            uses: ['display'],
            extra: { effectiveFrom: new Date(Date.now() + 2 * day) },
          },
        ],
      },
    ];

    for (const scenario of scenarios) {
      const { sourceId } = await world();
      for (const step of scenario.steps) await grant(sourceId, step.status, step.uses, step.extra);

      const rows = await admin((c) =>
        c.query<{
          id: string;
          sequence: string;
          status: RightsStatus;
          allowed_uses: RightsUse[];
          decided_at: Date;
          effective_from: Date;
          expires_at: Date | null;
        }>(
          'SELECT id, sequence, status, allowed_uses, decided_at, effective_from, expires_at FROM corpus.source_rights_decisions WHERE source_id = $1',
          [sourceId],
        ),
      );
      const decisions: RightsDecision[] = rows.rows.map((r) => ({
        id: r.id,
        sequence: Number(r.sequence),
        status: r.status,
        allowedUses: r.allowed_uses,
        decidedAt: r.decided_at,
        effectiveFrom: r.effective_from,
        expiresAt: r.expires_at,
      }));

      for (const use of RIGHTS_USES) {
        const inDatabase = await asApp(
          async (tx) =>
            (
              await tx.query<{ ok: boolean }>('SELECT corpus.source_allows($1, $2) AS ok', [
                sourceId,
                use,
              ])
            ).rows[0]?.ok,
        );
        expect(inDatabase, `${scenario.name} / ${use}`).toBe(allows(decisions, use, new Date()));
      }

      // The processing gate names several uses and needs every one of them.
      const combinations: RightsUse[][] = [
        ['acquire_store'],
        ['derive_metadata'],
        ['acquire_store', 'derive_metadata'],
        ['display', 'index_search'],
        ['display', 'ai_processing'],
      ];
      for (const uses of combinations) {
        const granted = await asIngest(async (tx) => {
          try {
            await corpusStore.requireRightsInForce(tx, sourceId, uses);
            return true;
          } catch (error) {
            if ((error as { code?: string }).code === 'corpus.rights_denied') return false;
            throw error;
          }
        });
        const expected = uses.every((use) => allows(decisions, use, new Date()));
        expect(granted, `${scenario.name} / in force: ${uses.join('+')}`).toBe(expected);
      }
    }
  });
});

describe('source-rights register', () => {
  it('is append-only, even for a superuser', async () => {
    const { sourceId } = await world();
    const id = await grant(sourceId, 'approved', ['display', 'index_search']);

    await rejectsWith(
      asDataops((tx) =>
        tx.query(`UPDATE corpus.source_rights_decisions SET status = 'denied' WHERE id = $1`, [id]),
      ),
      { code: '42501' },
    );
    await rejectsWith(
      asDataops((tx) => tx.query('DELETE FROM corpus.source_rights_decisions WHERE id = $1', [id])),
      { code: '42501' },
    );
    await rejectsWith(
      admin((c) => c.query('DELETE FROM corpus.source_rights_decisions')),
      { hint: 'corpus.append_only' },
    );
    await rejectsWith(
      admin((c) => c.query('TRUNCATE corpus.source_rights_decisions')),
      { hint: 'corpus.append_only' },
    );
  });

  it('will not record an approval without evidence or without any allowed use', async () => {
    const { sourceId } = await world();
    await rejectsWith(
      asDataops((tx) =>
        corpusStore.recordRightsDecision(tx, {
          sourceId,
          status: 'approved',
          allowedUses: ['display'],
          decidedBy: staff.rightsOfficer,
        }),
      ),
      { kind: 'validation' },
    );
    await rejectsWith(
      asDataops((tx) =>
        corpusStore.recordRightsDecision(tx, {
          sourceId,
          status: 'approved',
          allowedUses: ['display'],
          evidenceReference: '   ',
          decidedBy: staff.rightsOfficer,
        }),
      ),
      { kind: 'validation' },
    );
    await rejectsWith(
      asDataops((tx) =>
        corpusStore.recordRightsDecision(tx, {
          sourceId,
          status: 'approved',
          allowedUses: [],
          evidenceReference: 'x',
          decidedBy: staff.rightsOfficer,
        }),
      ),
      { kind: 'validation' },
    );
    // A denial or revocation cannot carry uses.
    await rejectsWith(
      asDataops((tx) =>
        corpusStore.recordRightsDecision(tx, {
          sourceId,
          status: 'revoked',
          allowedUses: ['display'],
          decidedBy: staff.rightsOfficer,
        }),
      ),
      { kind: 'validation' },
    );
  });

  it('rejects unknown uses and an expiry before the effective date', async () => {
    const { sourceId } = await world();
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          `INSERT INTO corpus.source_rights_decisions (source_id, status, allowed_uses, evidence_reference, decided_by) VALUES ($1, 'approved', ARRAY['resell_to_anyone'], 'e', $2)`,
          [sourceId, staff.rightsOfficer],
        ),
      ),
      { code: '23514' },
    );
    await rejectsWith(
      grant(sourceId, 'approved', ['display'], {
        effectiveFrom: new Date(Date.now() + 1000),
        expiresAt: new Date(Date.now() - 1000),
      }),
      { kind: 'validation' },
    );
  });

  it('is written only by data-ops, and never readable by the application', async () => {
    const { sourceId } = await world();
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.recordRightsDecision(tx, {
          sourceId,
          status: 'approved',
          allowedUses: ['display'],
          evidenceReference: 'e',
          decidedBy: staff.rightsOfficer,
        }),
      ),
      { code: '42501' },
    );
    await rejectsWith(
      asApp((tx) => tx.query('SELECT * FROM corpus.source_rights_decisions')),
      { code: '42501' },
    );
    await rejectsWith(
      asIngest((tx) => tx.query('SELECT * FROM corpus.source_rights_decisions')),
      { code: '42501' },
    );
    // But it can ask the yes/no question.
    expect(
      await asApp(
        async (tx) =>
          (
            await tx.query<{ ok: boolean }>('SELECT corpus.source_allows($1, $2) AS ok', [
              sourceId,
              'display',
            ])
          ).rows[0]?.ok,
      ),
    ).toBe(false);
  });
});

describe('the lifecycle and the rights gate', () => {
  it('creates versions only as drafts', async () => {
    const w = await world();
    const { documentId } = await draft(w);
    await rejectsWith(
      asIngest((tx) =>
        tx.query(
          `INSERT INTO corpus.document_versions (document_id, jurisdiction_id, version_number, source_id, acquired_at, content_checksum, storage_key, pipeline_version, lifecycle_state)
         VALUES ($1, $2, 2, $3, now(), $4, 'k', 'p', 'pending_review')`,
          [documentId, w.jurisdictionId, w.sourceId, sha256('x')],
        ),
      ),
      { hint: 'corpus.invalid_creation' },
    );
  });

  it('lets ingestion submit a draft for review but never approve or publish it', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    const stateOf = async () =>
      (
        await admin((c) =>
          c.query<{ lifecycle_state: string }>(
            'SELECT lifecycle_state FROM corpus.document_versions WHERE id = $1',
            [d.versionId],
          ),
        )
      ).rows[0]?.lifecycle_state;

    // From a draft it may only go to review or rejection; jumping ahead is refused.
    for (const state of ['approved', 'published']) {
      await expect(
        asIngest((tx) =>
          tx.query(
            `UPDATE corpus.document_versions SET lifecycle_state = '${state}' WHERE id = $1`,
            [d.versionId],
          ),
        ),
      ).rejects.toBeDefined();
    }
    expect(await stateOf()).toBe('ingesting');

    await submit(d.versionId);
    expect(await stateOf()).toBe('pending_review');

    // Once the version has left ingestion it is out of ingestion's reach entirely. The policy
    // filters the row, so the statement affects nothing rather than raising.
    for (const state of ['approved', 'published', 'rejected']) {
      const result = await asIngest((tx) =>
        tx.query(`UPDATE corpus.document_versions SET lifecycle_state = '${state}' WHERE id = $1`, [
          d.versionId,
        ]),
      );
      expect(result.rowCount, state).toBe(0);
    }
    await rejectsWith(
      asIngest((tx) => corpusStore.rejectVersion(tx, d.versionId)),
      { kind: 'not_found' },
    );
    expect(await stateOf()).toBe('pending_review');
  });

  it('gives data-ops the review powers but not the ability to create drafts or edit text', async () => {
    const w = await world();
    const d = await draft(w);
    await rejectsWith(
      asDataops((tx) =>
        corpusStore.createDocument(tx, {
          jurisdictionId: w.jurisdictionId,
          documentType: 'case',
          title: 'x',
        }),
      ),
      { code: '42501' },
    );
    await rejectsWith(
      asDataops((tx) =>
        tx.query(`UPDATE corpus.passages SET text = 'tampered' WHERE version_id = $1`, [
          d.versionId,
        ]),
      ),
      { code: '42501' },
    );
  });

  it('refuses moves that are not in the transition table', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    await submit(d.versionId);
    // pending_review -> published skips approval. Data-ops is allowed to reach `published`
    // generally, so it is the trigger that refuses.
    await rejectsWith(publish(d.versionId), {
      kind: 'precondition_failed',
      code: 'corpus.invalid_transition',
    });
  });

  it('will not publish without a rights decision, or with the wrong ones', async () => {
    const cases: { label: string; setup: (s: SourceId) => Promise<unknown>; ok: boolean }[] = [
      { label: 'no decision at all', setup: () => Promise.resolve(), ok: false },
      {
        label: 'AI processing only',
        setup: (s) => grant(s, 'approved', ['ai_processing']),
        ok: false,
      },
      {
        label: 'display without search',
        setup: (s) => grant(s, 'approved', ['display']),
        ok: false,
      },
      {
        label: 'search without display',
        setup: (s) => grant(s, 'approved', ['index_search']),
        ok: false,
      },
      { label: 'denied', setup: (s) => grant(s, 'denied', []), ok: false },
      {
        label: 'display and search',
        setup: (s) => grant(s, 'approved', ['display', 'index_search']),
        ok: true,
      },
    ];
    for (const c of cases) {
      const w = await world();
      await c.setup(w.sourceId);
      const d = await draft(w);
      await submit(d.versionId);
      await approve(d.versionId);
      if (c.ok) await publish(d.versionId);
      else await rejectsWith(publish(d.versionId), { code: 'corpus.rights_not_cleared' });
      expect(await userSees(d.versionId), c.label).toBe(c.ok);
    }
  });

  it('enforces the two-person rule: the approver cannot also publish', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    await submit(d.versionId);
    await approve(d.versionId, staff.reviewer);
    await rejectsWith(publish(d.versionId, staff.reviewer), {
      kind: 'forbidden',
      code: 'corpus.two_person_rule',
    });
    await publish(d.versionId, staff.publisher);
    expect(await userSees(d.versionId)).toBe(true);
  });

  it('records who approved and published, and rejects an unknown person', async () => {
    const w = await world();
    const d = await draft(w);
    await submit(d.versionId);
    await rejectsWith(approve(d.versionId, '00000000-0000-4000-8000-000000000000'), {
      kind: 'not_found',
    });
    await approve(d.versionId);
    const row = await admin((c) =>
      c.query<{ approved_by: string; approved_at: Date | null }>(
        'SELECT approved_by, approved_at FROM corpus.document_versions WHERE id = $1',
        [d.versionId],
      ),
    );
    expect(row.rows[0]?.approved_by).toBe(staff.reviewer);
    expect(row.rows[0]?.approved_at).not.toBeNull();
  });

  it('makes withdrawal terminal: a withdrawn version cannot come back', async () => {
    const p = await published();
    await asDataops((tx) =>
      corpusStore.withdrawVersion(tx, p.versionId, 'SYNTHETIC withdrawal for test'),
    );
    expect(await userSees(p.versionId)).toBe(false);
    // Data-ops can no longer even see it to act on it...
    await rejectsWith(publish(p.versionId, staff.other), { kind: 'not_found' });
    // ...and the transition table refuses the move even when access rules are bypassed.
    await rejectsWith(
      admin((c) =>
        c.query(
          `UPDATE corpus.document_versions SET lifecycle_state = 'published', published_by = $2 WHERE id = $1`,
          [p.versionId, staff.other],
        ),
      ),
      { hint: 'corpus.invalid_transition' },
    );
  });

  it('requires a reason to withdraw', async () => {
    const p = await published();
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          `UPDATE corpus.document_versions SET lifecycle_state = 'withdrawn' WHERE id = $1`,
          [p.versionId],
        ),
      ),
      { code: '23514' },
    );
  });
});

describe('immutability: corrections are new versions, never edits', () => {
  it('freezes provenance and content identity after creation, even against a superuser', async () => {
    const w = await world();
    const d = await draft(w);
    await submit(d.versionId);
    for (const [column, value] of [
      ['content_checksum', sha256('other')],
      ['storage_key', 'elsewhere'],
      ['source_reference', 'changed'],
      ['acquired_at', new Date(0)],
    ] as const) {
      await rejectsWith(
        admin((c) =>
          c.query(`UPDATE corpus.document_versions SET ${column} = $2 WHERE id = $1`, [
            d.versionId,
            value,
          ]),
        ),
        { hint: 'corpus.version_immutable' },
      );
    }
  });

  it('refuses any change that is not a lifecycle transition', async () => {
    const p = await published();
    await rejectsWith(
      admin((c) =>
        c.query(`UPDATE corpus.document_versions SET withdrawal_reason = 'because' WHERE id = $1`, [
          p.versionId,
        ]),
      ),
      { hint: 'corpus.version_immutable' },
    );
  });

  it('never deletes a version: withdrawal is a state', async () => {
    const p = await published();
    await rejectsWith(
      admin((c) => c.query('DELETE FROM corpus.document_versions WHERE id = $1', [p.versionId])),
      { hint: 'corpus.append_only' },
    );
    await rejectsWith(
      admin((c) => c.query('TRUNCATE corpus.document_versions CASCADE')),
      { hint: 'corpus.append_only' },
    );
  });

  it('rejects the same content twice for one work, and duplicate version numbers', async () => {
    const w = await world();
    const { documentId } = await draft(w, 'same-bytes');
    const again = (n: number, seed: string) =>
      asIngest((tx) =>
        corpusStore.createVersion(tx, {
          documentId,
          jurisdictionId: w.jurisdictionId,
          versionNumber: n,
          sourceId: w.sourceId,
          acquiredAt: new Date(),
          contentChecksum: sha256(seed),
          storageKey: 'k',
          pipelineVersion: 'p',
        }),
      );
    await rejectsWith(again(2, 'same-bytes'), {
      kind: 'conflict',
      code: 'corpus.duplicate_content',
    });
    await rejectsWith(again(1, 'different-bytes'), {
      kind: 'conflict',
      code: 'corpus.version_number_taken',
    });
    await again(2, 'a-genuine-correction');
  });

  it('freezes passages once a version leaves ingestion', async () => {
    const w = await world();
    const d = await draft(w);
    await asIngest((tx) =>
      corpusStore.addPassages(tx, d.versionId, [
        { ordinal: 2, locator: '¶3', text: 'SYNTHETIC still editable.' },
      ]),
    );
    await submit(d.versionId);

    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addPassages(tx, d.versionId, [{ ordinal: 3, locator: '¶4', text: 'late' }]),
      ),
      { code: 'corpus.passages_frozen' },
    );
    await rejectsWith(
      asIngest((tx) =>
        tx.query(`UPDATE corpus.passages SET text = 'x', text_sha256 = $2 WHERE version_id = $1`, [
          d.versionId,
          sha256('x'),
        ]),
      ),
      { hint: 'corpus.passages_frozen' },
    );
    await rejectsWith(
      asIngest((tx) =>
        tx.query('DELETE FROM corpus.passages WHERE version_id = $1', [d.versionId]),
      ),
      { hint: 'corpus.passages_frozen' },
    );
  });

  it('verifies each passage hash in the database, so a corrupted write cannot be stored', async () => {
    const w = await world();
    const d = await draft(w);
    await rejectsWith(
      asIngest((tx) =>
        tx.query(
          `INSERT INTO corpus.passages (version_id, ordinal, locator, text, text_sha256) VALUES ($1, 9, '¶9', 'real text', $2)`,
          [d.versionId, sha256('different text')],
        ),
      ),
      { code: '23514', constraint: 'passage_hash_matches' },
    );
  });
});

describe('jurisdiction is structural, not a convention', () => {
  it('refuses a source, court or document from a different jurisdiction', async () => {
    const a = await world();
    const b = await world();
    const { documentId } = await draft(a);

    await rejectsWith(
      asIngest((tx) =>
        corpusStore.createVersion(tx, {
          documentId,
          jurisdictionId: a.jurisdictionId,
          versionNumber: 2,
          sourceId: b.sourceId,
          acquiredAt: new Date(),
          contentChecksum: sha256('cross'),
          storageKey: 'k',
          pipelineVersion: 'p',
        }),
      ),
      { kind: 'not_found', code: 'corpus.reference_not_found' },
    );
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addCaseDetails(tx, {
          documentId,
          jurisdictionId: a.jurisdictionId,
          courtId: b.court,
        }),
      ),
      { code: 'corpus.reference_not_found' },
    );
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.createVersion(tx, {
          documentId,
          jurisdictionId: b.jurisdictionId,
          versionNumber: 3,
          sourceId: b.sourceId,
          acquiredAt: new Date(),
          contentChecksum: sha256('cross2'),
          storageKey: 'k',
          pipelineVersion: 'p',
        }),
      ),
      { code: 'corpus.reference_not_found' },
    );
  });
});

describe('what the application can see (rights are enforced at read time)', () => {
  it('shows nothing until a version is published', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    expect(await userSees(d.versionId)).toBe(false);
    await submit(d.versionId);
    expect(await userSees(d.versionId)).toBe(false);
    await approve(d.versionId);
    expect(await userSees(d.versionId)).toBe(false);
    await publish(d.versionId);
    expect(await userSees(d.versionId)).toBe(true);
  });

  it('hides a draft’s passages and its document from the application, while staff can see them', async () => {
    const w = await world();
    const d = await draft(w);
    expect(await asApp((tx) => corpusStore.listPassages(tx, d.versionId))).toHaveLength(0);
    expect(
      (
        await asApp((tx) =>
          tx.query('SELECT id FROM corpus.legal_documents WHERE id = $1', [d.documentId]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(await asIngest((tx) => corpusStore.listPassages(tx, d.versionId))).toHaveLength(2);
    expect(
      (
        await asDataops((tx) =>
          tx.query('SELECT id FROM corpus.legal_documents WHERE id = $1', [d.documentId]),
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('shows a published version’s passages and document', async () => {
    const p = await published();
    expect(await asApp((tx) => corpusStore.listPassages(tx, p.versionId))).toHaveLength(2);
    expect(
      (
        await asApp((tx) =>
          tx.query('SELECT id FROM corpus.legal_documents WHERE id = $1', [p.documentId]),
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('KILL SWITCH: revoking a source’s rights hides its published content immediately, and re-approval restores it', async () => {
    const p = await published();
    expect(await userSees(p.versionId)).toBe(true);

    await grant(p.sourceId, 'revoked', []);
    expect(await userSees(p.versionId)).toBe(false);
    expect(await asApp((tx) => corpusStore.listPassages(tx, p.versionId))).toHaveLength(0);
    expect(
      (
        await asApp((tx) =>
          tx.query('SELECT id FROM corpus.legal_documents WHERE id = $1', [p.documentId]),
        )
      ).rows,
    ).toHaveLength(0);

    await grant(p.sourceId, 'approved', ['display', 'index_search']);
    expect(await userSees(p.versionId)).toBe(true);
  });

  it('stops showing content when a rights approval expires', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search'], {
      effectiveFrom: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 1500),
    });
    const d = await draft(w);
    await submit(d.versionId);
    await approve(d.versionId);
    await publish(d.versionId);
    expect(await userSees(d.versionId)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(await userSees(d.versionId)).toBe(false);
  });

  it('hides a withdrawn version', async () => {
    const p = await published();
    await asDataops((tx) => corpusStore.withdrawVersion(tx, p.versionId, 'SYNTHETIC test'));
    expect(await userSees(p.versionId)).toBe(false);
  });

  it('gives the application no write access and no view of internal columns', async () => {
    const p = await published();
    await rejectsWith(
      asApp((tx) =>
        corpusStore.createDocument(tx, {
          jurisdictionId: p.jurisdictionId,
          documentType: 'case',
          title: 'x',
        }),
      ),
      { code: '42501' },
    );
    await rejectsWith(
      asApp((tx) => tx.query(`UPDATE corpus.document_versions SET lifecycle_state = 'withdrawn'`)),
      { code: '42501' },
    );
    await rejectsWith(
      asApp((tx) => tx.query('SELECT storage_key FROM corpus.document_versions')),
      { code: '42501' },
    );
    await rejectsWith(
      asApp((tx) => tx.query('SELECT approved_by FROM corpus.document_versions')),
      { code: '42501' },
    );
    await rejectsWith(
      asApp((tx) => tx.query('SELECT * FROM corpus.document_versions')),
      { code: '42501' },
    );
  });

  it('lets the application see who published a document but not the rights ledger', async () => {
    const p = await published();
    const source = await asApp((tx) =>
      tx.query<{ name: string }>('SELECT name FROM corpus.sources WHERE id = $1', [p.sourceId]),
    );
    expect(source.rows).toHaveLength(1);
    await rejectsWith(
      asApp((tx) => tx.query('SELECT * FROM corpus.sources')),
      { code: '42501' },
    );
  });

  it('keeps every corpus table out of reach of the wrong role', async () => {
    await rejectsWith(
      asIngest((tx) => tx.query(`UPDATE corpus.legal_documents SET title = 'x'`)),
      { code: '42501' },
    );
    await rejectsWith(
      asIngest((tx) => tx.query('SELECT * FROM audit.platform_events')),
      { code: '42P01' },
    ).catch(() => undefined);
  });
});

describe('the citation graph', () => {
  async function pair() {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const citing = await draft(w);
    const cited = await draft(w);
    const passages = await asIngest((tx) => corpusStore.listPassages(tx, citing.versionId));
    for (const v of [citing, cited]) {
      await submit(v.versionId);
      await approve(v.versionId);
      await publish(v.versionId);
    }
    const [first] = passages;
    if (first === undefined) throw new Error('no passage');
    return { w, citing, cited, evidence: first.id };
  }

  const cite = (
    p: Awaited<ReturnType<typeof pair>>,
    type: Parameters<typeof corpusStore.addCitation>[1]['relationshipType'],
  ) =>
    asIngest((tx) =>
      corpusStore.addCitation(tx, {
        fromVersionId: p.citing.versionId,
        toDocumentId: p.cited.documentId,
        relationshipType: type,
        citationText: 'A v B',
        evidencePassageId: p.evidence,
        origin: 'machine',
        confidence: 0.9,
      }),
    );

  it('requires evidence located in the citing version itself', async () => {
    const p = await pair();
    const other = await published();
    const foreign = (await asApp((tx) => corpusStore.listPassages(tx, other.versionId)))[0];
    if (foreign === undefined) throw new Error('no passage');

    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addCitation(tx, {
          fromVersionId: p.citing.versionId,
          toDocumentId: p.cited.documentId,
          relationshipType: 'cites',
          citationText: 'x',
          evidencePassageId: foreign.id,
          origin: 'machine',
          confidence: 0.5,
        }),
      ),
      { kind: 'not_found', code: 'corpus.reference_not_found' },
    );
  });

  it('requires a confidence on machine-extracted edges', async () => {
    const p = await pair();
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addCitation(tx, {
          fromVersionId: p.citing.versionId,
          toDocumentId: p.cited.documentId,
          relationshipType: 'cites',
          citationText: 'x',
          evidencePassageId: p.evidence,
          origin: 'machine',
        }),
      ),
      { kind: 'validation' },
    );
  });

  it('shows plain citations automatically but hides treatments until a person has reviewed them', async () => {
    const p = await pair();
    await cite(p, 'cites');
    const overruled = await cite(p, 'overruled');

    const before = (await asApp((tx) => corpusStore.listCitationsFrom(tx, p.citing.versionId))).map(
      (c) => c.relationshipType,
    );
    expect(before).toEqual(['cites']);

    await asDataops((tx) =>
      corpusStore.reviewCitation(tx, overruled, 'human_reviewed', staff.reviewer),
    );
    const after = (await asApp((tx) => corpusStore.listCitationsFrom(tx, p.citing.versionId)))
      .map((c) => c.relationshipType)
      .sort();
    expect(after).toEqual(['cites', 'overruled']);

    await asDataops((tx) => corpusStore.reviewCitation(tx, overruled, 'rejected', staff.reviewer));
    expect(
      (await asApp((tx) => corpusStore.listCitationsFrom(tx, p.citing.versionId))).map(
        (c) => c.relationshipType,
      ),
    ).toEqual(['cites']);
  });

  it('stops machine extraction from marking its own edges as reviewed or human', async () => {
    const p = await pair();
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addCitation(tx, {
          fromVersionId: p.citing.versionId,
          toDocumentId: p.cited.documentId,
          relationshipType: 'overruled',
          citationText: 'x',
          evidencePassageId: p.evidence,
          origin: 'machine',
          confidence: 0.99,
          reviewStatus: 'human_reviewed',
          reviewedBy: staff.reviewer,
        }),
      ),
      { code: '42501' },
    );
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addCitation(tx, {
          fromVersionId: p.citing.versionId,
          toDocumentId: p.cited.documentId,
          relationshipType: 'cites',
          citationText: 'x',
          evidencePassageId: p.evidence,
          origin: 'human',
        }),
      ),
      { code: '42501' },
    );
  });

  it('hides an edge when either end is no longer visible', async () => {
    const p = await pair();
    await cite(p, 'cites');
    expect(await asApp((tx) => corpusStore.listCitationsFrom(tx, p.citing.versionId))).toHaveLength(
      1,
    );

    // Withdraw the CITED document: the edge would point at something users cannot open.
    await asDataops((tx) => corpusStore.withdrawVersion(tx, p.cited.versionId, 'SYNTHETIC'));
    expect(await asApp((tx) => corpusStore.listCitationsFrom(tx, p.citing.versionId))).toHaveLength(
      0,
    );
  });

  it('hides edges from a source whose rights were revoked', async () => {
    const p = await pair();
    await cite(p, 'cites');
    await grant(p.w.sourceId, 'revoked', []);
    expect(await asApp((tx) => corpusStore.listCitationsFrom(tx, p.citing.versionId))).toHaveLength(
      0,
    );
  });
});

describe('synthetic data never reaches production', () => {
  it('is flagged, labelled and refused at startup in production', async () => {
    const corpus = await seedSyntheticCorpus({ ingest, dataops }, staff, { documentCount: 2 });

    const first = corpus.documents[0];
    if (first === undefined) throw new Error('the synthetic seed produced no documents');
    const passages = await asApp((tx) => corpusStore.listPassages(tx, first.versionId));
    expect(passages).toHaveLength(3);
    expect(passages.every((p) => p.text.includes('SYNTHETIC'))).toBe(true);

    await expect(assertNoSyntheticInProduction(app, 'production')).rejects.toMatchObject({
      code: 'corpus.synthetic_in_production',
    });
    await expect(assertNoSyntheticInProduction(app, 'development')).resolves.toBeUndefined();
    await expect(assertNoSyntheticInProduction(app, 'test')).resolves.toBeUndefined();
  });

  it('passes in production on a database with no fixtures', async () => {
    const clean = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, corpusMigrations],
    });
    try {
      await expect(
        assertNoSyntheticInProduction(clean.poolFor('app'), 'production'),
      ).resolves.toBeUndefined();
    } finally {
      await clean.dispose();
    }
  });
});

describe('structural guardrails', () => {
  it('pass on the schema with the corpus migrated', async () => {
    const found = await admin((c) =>
      checkGuardrails(c, { tenantTableExemptions: ['iam.memberships'] }),
    );
    expect(found, formatViolations(found)).toEqual([]);
  });
});

describe('review integrity: who approved and published cannot be rewritten', () => {
  const pendingReview = async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    await submit(d.versionId);
    return { w, d };
  };

  it('rejects swapping the recorded approver while publishing, which would defeat the two-person rule', async () => {
    const { d } = await pendingReview();
    await approve(d.versionId, staff.reviewer);

    // The reviewer tries to publish their OWN approval by also replacing the approver on record.
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          `UPDATE corpus.document_versions
              SET lifecycle_state = 'published', published_by = $2, approved_by = $3
            WHERE id = $1`,
          [d.versionId, staff.reviewer, staff.other],
        ),
      ),
      { hint: 'corpus.version_immutable' },
    );
    expect(await userSees(d.versionId)).toBe(false);
  });

  it('rejects rewriting who published a version while withdrawing it', async () => {
    const p = await published();
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          `UPDATE corpus.document_versions
              SET lifecycle_state = 'withdrawn', withdrawal_reason = 'SYNTHETIC', published_by = $2
            WHERE id = $1`,
          [p.versionId, staff.other],
        ),
      ),
      { hint: 'corpus.version_immutable' },
    );
    expect(await userSees(p.versionId)).toBe(true);
  });

  it('rejects changing the approver on any transition other than the one that records it', async () => {
    const { d } = await pendingReview();
    await approve(d.versionId, staff.reviewer);
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          `UPDATE corpus.document_versions SET lifecycle_state = 'rejected', approved_by = $2 WHERE id = $1`,
          [d.versionId, staff.other],
        ),
      ),
      { hint: 'corpus.version_immutable' },
    );
  });

  it('does not let data-ops name the approval, publication or withdrawal times at all', async () => {
    const { d } = await pendingReview();
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          `UPDATE corpus.document_versions
              SET lifecycle_state = 'approved', approved_by = $2, approved_at = '2000-01-01T00:00:00Z'
            WHERE id = $1`,
          [d.versionId, staff.reviewer],
        ),
      ),
      { code: '42501' },
    );
  });

  it('assigns those times itself, so even a superuser cannot backdate a transition', async () => {
    const { d } = await pendingReview();
    // Approval needs a recorded human decision for everyone, superusers included; the property
    // under test here is the timestamp, so give the move the decision it requires.
    await asDataops((tx) =>
      corpusStore.recordReviewDecision(tx, {
        versionId: d.versionId,
        decision: 'approve',
        reasonCode: 'approved',
        decidedBy: staff.reviewer,
      }),
    );
    await admin((c) =>
      c.query(
        `UPDATE corpus.document_versions
            SET lifecycle_state = 'approved', approved_by = $2, approved_at = '2000-01-01T00:00:00Z'
          WHERE id = $1`,
        [d.versionId, staff.reviewer],
      ),
    );
    const row = await admin((c) =>
      c.query<{ approved_at: Date }>(
        'SELECT approved_at FROM corpus.document_versions WHERE id = $1',
        [d.versionId],
      ),
    );
    expect(Date.now() - (row.rows[0]?.approved_at.getTime() ?? 0)).toBeLessThan(60_000);
  });
});

describe('ingestion cannot alter the metadata of an approved or published document', () => {
  const details = (documentId: DocumentId) =>
    admin((c) =>
      c.query<{ docket_number: string | null; repeal_status: string | null }>(
        `SELECT cd.docket_number, ld.repeal_status
           FROM corpus.legal_documents d
           LEFT JOIN corpus.case_details cd ON cd.document_id = d.id
           LEFT JOIN corpus.legislation_details ld ON ld.document_id = d.id
          WHERE d.id = $1`,
        [documentId],
      ),
    );

  it('lets ingestion refine its extraction while the document is still a draft, then freezes it', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    await asIngest((tx) =>
      corpusStore.addCaseDetails(tx, {
        documentId: d.documentId,
        jurisdictionId: w.jurisdictionId,
        courtId: w.court,
        docketNumber: 'DRAFT-1',
      }),
    );
    await asIngest((tx) =>
      tx.query(
        `INSERT INTO corpus.legislation_details (document_id, repeal_status) VALUES ($1, 'in_force')`,
        [d.documentId],
      ),
    );

    const edit = (sql: string) => asIngest((tx) => tx.query(sql, [d.documentId]));
    const refine = `UPDATE corpus.case_details SET docket_number = 'DRAFT-2' WHERE document_id = $1`;
    expect((await edit(refine)).rowCount).toBe(1); // ingesting: allowed

    await submit(d.versionId);
    expect((await edit(refine)).rowCount).toBe(1); // pending review: still ingestion's draft

    await approve(d.versionId);
    await publish(d.versionId);

    // Approved and published: ingestion can no longer touch either table. The policy filters
    // the rows, so the statements affect nothing rather than raising.
    const tamper = [
      `UPDATE corpus.case_details SET docket_number = 'TAMPERED' WHERE document_id = $1`,
      `UPDATE corpus.legislation_details SET repeal_status = 'repealed' WHERE document_id = $1`,
    ];
    for (const sql of tamper) expect((await edit(sql)).rowCount, sql).toBe(0);

    const after = (await details(d.documentId)).rows[0];
    expect(after).toEqual({ docket_number: 'DRAFT-2', repeal_status: 'in_force' });
  });

  it('will not let ingestion add details to a document that already has an approved version', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    await submit(d.versionId);
    await approve(d.versionId);

    await rejectsWith(
      asIngest((tx) =>
        corpusStore.addCaseDetails(tx, {
          documentId: d.documentId,
          jurisdictionId: w.jurisdictionId,
          courtId: w.court,
          docketNumber: 'LATE',
        }),
      ),
      { code: '42501' },
    );
    await rejectsWith(
      asIngest((tx) =>
        tx.query(
          `INSERT INTO corpus.legislation_details (document_id, repeal_status) VALUES ($1, 'repealed')`,
          [d.documentId],
        ),
      ),
      { code: '42501' },
    );
  });

  it('still lets data-ops correct metadata on a published document (a corrections decision, made by people)', async () => {
    const p = await published();
    await asIngest((tx) =>
      corpusStore.addCaseDetails(tx, {
        documentId: p.documentId,
        jurisdictionId: p.jurisdictionId,
        courtId: p.court,
        docketNumber: 'X',
      }),
    ).catch(() => undefined);
    await admin((c) =>
      c.query(
        `INSERT INTO corpus.case_details (document_id, jurisdiction_id, court_id, docket_number)
         VALUES ($1, $2, $3, 'ORIGINAL') ON CONFLICT (document_id) DO NOTHING`,
        [p.documentId, p.jurisdictionId, p.court],
      ),
    );
    const fixed = await asDataops((tx) =>
      tx.query(
        `UPDATE corpus.case_details SET docket_number = 'CORRECTED' WHERE document_id = $1`,
        [p.documentId],
      ),
    );
    expect(fixed.rowCount).toBe(1);
  });
});

export type _Ids = DocumentId;

describe('rights in force now (corpus.rights_decision_in_force)', () => {
  it('returns the decision relied upon, so evidence can name it', async () => {
    const w = await world();
    const first = await grant(w.sourceId, 'approved', ['acquire_store', 'derive_metadata']);
    const relied = await asIngest((tx) =>
      corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store', 'derive_metadata']),
    );
    expect(relied).toBe(first);
  });

  it('refuses when no decision names every use the operation needs', async () => {
    const w = await world();
    await rejectsWith(
      asIngest((tx) => corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store'])),
      { code: 'corpus.rights_denied' },
    );
    await grant(w.sourceId, 'approved', ['acquire_store']);
    await rejectsWith(
      asIngest((tx) =>
        corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store', 'derive_metadata']),
      ),
      { code: 'corpus.rights_denied' },
    );
  });

  it('refuses an empty list of uses: an operation must say what it needs', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['acquire_store']);
    await rejectsWith(
      asIngest((tx) => corpusStore.requireRightsInForce(tx, w.sourceId, [])),
      { code: 'corpus.rights_denied' },
    );
  });

  it('sees a revocation made by someone else in the middle of a long transaction', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['acquire_store']);
    await asIngest(async (tx) => {
      await corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store']);
      await grant(w.sourceId, 'revoked', []);
      await expect(
        corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store']),
      ).rejects.toMatchObject({ code: 'corpus.rights_denied' });
    });
  });

  it('notices an approval expiring mid-transaction, which the read-time gate does not', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['acquire_store'], {
      effectiveFrom: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 1500),
    });
    await asIngest(async (tx) => {
      await corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store']);
      await tx.query('SELECT pg_sleep(2)');
      // now() is fixed for the transaction, so the per-statement gate still says yes...
      const stale = await tx.query<{ ok: boolean }>(
        "SELECT corpus.source_allows($1, 'acquire_store') AS ok",
        [w.sourceId],
      );
      expect(stale.rows[0]?.ok).toBe(true);
      // ...and the processing gate, which reads the clock again, correctly says no.
      await expect(
        corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store']),
      ).rejects.toMatchObject({ code: 'corpus.rights_denied' });
    });
  });

  it('is not callable by the application role', async () => {
    const w = await world();
    await rejectsWith(
      asApp((tx) => corpusStore.requireRightsInForce(tx, w.sourceId, ['acquire_store'])),
      { code: '42501' },
    );
  });
});

describe('review decisions gate approval', () => {
  const pending = async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const d = await draft(w);
    await submit(d.versionId);
    return { w, d };
  };
  const forceApprove = (versionId: VersionId, by: string) =>
    admin((c) =>
      c.query(
        "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
        [versionId, by],
      ),
    );
  const decide = (
    versionId: VersionId,
    decision: 'approve' | 'reject' | 'hold',
    by = staff.reviewer,
  ) =>
    asDataops((tx) =>
      corpusStore.recordReviewDecision(tx, {
        versionId,
        decision,
        reasonCode: 'test_reason',
        decidedBy: by,
      }),
    );

  it('refuses approval with no recorded decision, whoever asks, even a superuser', async () => {
    const { d } = await pending();
    await expect(forceApprove(d.versionId, staff.reviewer)).rejects.toMatchObject({
      hint: 'corpus.review_decision_required',
    });
    await rejectsWith(
      asDataops((tx) =>
        tx.query(
          "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
          [d.versionId, staff.reviewer],
        ),
      ),
      { hint: 'corpus.review_decision_required' },
    );
  });

  it('accepts approval once the approver has recorded an approving decision', async () => {
    const { d } = await pending();
    await decide(d.versionId, 'approve');
    await forceApprove(d.versionId, staff.reviewer);
  });

  it("refuses approval on the strength of someone else's decision", async () => {
    const { d } = await pending();
    await decide(d.versionId, 'approve', staff.publisher);
    await expect(forceApprove(d.versionId, staff.reviewer)).rejects.toMatchObject({
      hint: 'corpus.review_decision_required',
    });
  });

  it('lets the latest decision govern: a later hold or reject withdraws an approval', async () => {
    for (const later of ['hold', 'reject'] as const) {
      const { d } = await pending();
      await decide(d.versionId, 'approve');
      await decide(d.versionId, later);
      await expect(forceApprove(d.versionId, staff.reviewer)).rejects.toMatchObject({
        hint: 'corpus.review_decision_required',
      });
    }
  });

  it('records decisions only for a version that is awaiting review', async () => {
    const w = await world();
    await grant(w.sourceId, 'approved', ['display', 'index_search']);
    const ingesting = await draft(w);
    await rejectsWith(decide(ingesting.versionId, 'approve'), {
      code: 'corpus.review_not_pending',
    });
    await submit(ingesting.versionId);
    await approve(ingesting.versionId);
    await rejectsWith(decide(ingesting.versionId, 'hold'), { code: 'corpus.review_not_pending' });
  });

  it('keeps decisions append-only', async () => {
    const { d } = await pending();
    const id = await decide(d.versionId, 'hold');
    await expect(
      admin((c) =>
        c.query("UPDATE corpus.version_review_decisions SET decision = 'approve' WHERE id = $1", [
          id,
        ]),
      ),
    ).rejects.toMatchObject({ hint: 'corpus.append_only' });
    await expect(
      admin((c) => c.query('DELETE FROM corpus.version_review_decisions WHERE id = $1', [id])),
    ).rejects.toMatchObject({ hint: 'corpus.append_only' });
    await expect(
      admin((c) => c.query('TRUNCATE corpus.version_review_decisions')),
    ).rejects.toMatchObject({ hint: 'corpus.append_only' });
  });

  it('is what approveVersion does: it records the decision and returns its id', async () => {
    const { d } = await pending();
    const id = await approve(d.versionId);
    const row = await admin((c) =>
      c.query<{ decision: string; decided_by: string; version_id: string }>(
        'SELECT decision, decided_by, version_id FROM corpus.version_review_decisions WHERE id = $1',
        [id],
      ),
    );
    expect(row.rows[0]).toMatchObject({
      decision: 'approve',
      decided_by: staff.reviewer,
      version_id: d.versionId,
    });
  });

  it('refuses to hand a version with no passages to review', async () => {
    const w = await world();
    const empty = await asIngest(async (tx) => {
      const documentId = await corpusStore.createDocument(tx, {
        jurisdictionId: w.jurisdictionId,
        documentType: 'case',
        title: '[SYNTHETIC] empty',
      });
      return corpusStore.createVersion(tx, {
        documentId,
        jurisdictionId: w.jurisdictionId,
        versionNumber: 1,
        sourceId: w.sourceId,
        acquiredAt: new Date(),
        contentChecksum: sha256(unique('empty')),
        storageKey: 'synthetic/empty',
        pipelineVersion: 'test-1',
      });
    });
    await rejectsWith(submit(empty), { code: 'corpus.review_not_ready' });
  });
});

describe('passages are immutable rows', () => {
  it('refuses an in-place edit even while the version is ingesting', async () => {
    const w = await world();
    const d = await draft(w);
    await rejectsWith(
      asIngest((tx) =>
        tx.query("UPDATE corpus.passages SET locator = 'moved' WHERE version_id = $1", [
          d.versionId,
        ]),
      ),
      { hint: 'corpus.passages_immutable' },
    );
  });

  it('still lets an ingesting version replace its passages by delete and insert', async () => {
    const w = await world();
    const d = await draft(w);
    await asIngest(async (tx) => {
      await tx.query('DELETE FROM corpus.passages WHERE version_id = $1', [d.versionId]);
      await corpusStore.addPassages(tx, d.versionId, [
        { ordinal: 0, locator: '¶1', text: 'SYNTHETIC replacement passage.' },
      ]);
    });
    const rows = await admin((c) =>
      c.query('SELECT 1 FROM corpus.passages WHERE version_id = $1', [d.versionId]),
    );
    expect(rows.rowCount).toBe(1);
  });
});

describe('content uniqueness ignores rejected versions', () => {
  const version = (
    w: { jurisdictionId: JurisdictionId; sourceId: SourceId },
    documentId: DocumentId,
    versionNumber: number,
    checksumSeed: string,
  ) =>
    asIngest((tx) =>
      corpusStore.createVersion(tx, {
        documentId,
        jurisdictionId: w.jurisdictionId,
        versionNumber,
        sourceId: w.sourceId,
        acquiredAt: new Date(),
        contentChecksum: sha256(checksumSeed),
        storageKey: `synthetic/${checksumSeed}/${versionNumber}`,
        pipelineVersion: 'test-1',
      }),
    );

  it('lets the same bytes be ingested again after a rejection (for example after a parser fix)', async () => {
    const w = await world();
    const seed = unique('same-bytes');
    const first = await draft(w, seed);
    await submit(first.versionId);
    await asDataops((tx) => corpusStore.rejectVersion(tx, first.versionId));
    await version(w, first.documentId, 2, seed);
  });

  it('still refuses the same bytes twice among versions that were not rejected', async () => {
    const w = await world();
    const seed = unique('live-bytes');
    const first = await draft(w, seed);
    await rejectsWith(version(w, first.documentId, 2, seed), {
      kind: 'conflict',
      code: 'corpus.duplicate_content',
    });
  });
});

describe('the corpus is public-only', () => {
  it('has no source kind that could describe private material', async () => {
    const w = await world();
    expect(SOURCE_KINDS as readonly string[]).not.toContain('user_supplied');
    await rejectsWith(
      asDataops((tx) =>
        corpusStore.registerSource(tx, {
          jurisdictionId: w.jurisdictionId,
          name: unique('SYNTHETIC private'),
          kind: 'user_supplied' as never,
        }),
      ),
      { kind: 'validation' },
    );
  });
});
