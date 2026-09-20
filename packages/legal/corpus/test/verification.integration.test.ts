import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CRITICAL_FIELDS, METADATA_FIELDS, VERIFICATION_STATUSES, fieldFingerprint } from '../src';
import { createHarness, type Harness } from './harness';

/**
 * Publish-critical metadata (title, jurisdiction and, by document type, court, decision date and
 * identifiers) must be verified by a person before a version can be approved. Machine extraction
 * stays separate: this is an append-only, field-level, human record, bound to the exact value the
 * reviewer saw, and the approval gate reads it.
 */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.dispose();
});

const REFUSED = { code: 'corpus.metadata_unverified' };
// The table privilege itself, not merely the function a trigger calls (which is a second layer).
const tablePrivilege: unknown = expect.stringMatching(/table version_field_verifications/);

// =============================================================================================
describe('a version cannot be approved while publish-critical metadata is machine-only', () => {
  it('refuses to approve a version whose fields nobody has verified', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await expect(h.approve(versionId)).rejects.toMatchObject(REFUSED);
    expect(await h.stateOf(versionId)).toBe('pending_review');
    // The refused approval left no decision behind: it ran in one transaction.
    expect(
      await h.count(
        'SELECT count(*) AS n FROM corpus.version_review_decisions WHERE version_id = $1',
        [versionId],
      ),
    ).toBe(0);
  });

  it('names what blocks it: every required field, and every optional one that has a value', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w, { neutralCitation: '[SYNTHETIC 1]' });
    const rows = await h.metadataOf(versionId);
    const blocking = rows.filter((row) => row.blocking).map((row) => row.field);
    expect(blocking.sort()).toEqual(
      ['court', 'decision_date', 'jurisdiction', 'neutral_citation', 'title'].sort(),
    );
    // docket_number has no value and is only "if present", so nothing is asked of it.
    expect(rows.find((row) => row.field === 'docket_number')?.blocking).toBe(false);
  });

  it('refuses while a required field is not recorded at all', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w, 'none'); // a case with no court, no date
    await h.verify(versionId, 'title');
    await h.verify(versionId, 'jurisdiction');
    const rows = await h.metadataOf(versionId);
    expect(rows.find((row) => row.field === 'court')).toMatchObject({
      value: null,
      blocking: true,
    });
    await expect(h.approve(versionId)).rejects.toMatchObject(REFUSED);
  });

  it('refuses while a recorded court or decision date is unverified, though title and jurisdiction are', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await h.verify(versionId, 'title');
    await h.verify(versionId, 'jurisdiction');
    await h.verify(versionId, 'court');
    await expect(h.approve(versionId)).rejects.toMatchObject(REFUSED); // decision_date is missing
    await h.verify(versionId, 'decision_date');
    await h.approve(versionId);
    expect(await h.stateOf(versionId)).toBe('approved');
  });

  it('permits approval once every critical field is verified', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await h.verifyAll(versionId);
    await h.approve(versionId);
    expect(await h.stateOf(versionId)).toBe('approved');
  });

  it('asks about an optional field only when it has a value', async () => {
    const w = await h.world();
    const withCitation = await h.pendingCase(w, { neutralCitation: '[SYNTHETIC 2]' });
    for (const field of ['title', 'jurisdiction', 'court', 'decision_date'] as const) {
      await h.verify(withCitation.versionId, field);
    }
    await expect(h.approve(withCitation.versionId)).rejects.toMatchObject(REFUSED);
    await h.verify(withCitation.versionId, 'neutral_citation');
    await h.approve(withCitation.versionId);

    const without = await h.pendingCase(w);
    await h.verifyAll(without.versionId); // no citation, no docket number: nothing more to verify
    await h.approve(without.versionId);
  });

  it('needs only the title and jurisdiction for legislation, and an identifier only if one is recorded', async () => {
    const w = await h.world();
    const plain = await h.pendingLegislation(w);
    await h.verify(plain.versionId, 'title');
    await h.verify(plain.versionId, 'jurisdiction');
    await h.approve(plain.versionId);

    const numbered = await h.pendingLegislation(w, 'SYNTHETIC-INSTRUMENT-1');
    await h.verify(numbered.versionId, 'title');
    await h.verify(numbered.versionId, 'jurisdiction');
    await expect(h.approve(numbered.versionId)).rejects.toMatchObject(REFUSED);
    await h.verify(numbered.versionId, 'instrument_number');
    await h.approve(numbered.versionId);
  });

  it('does not ask a legislation document about a court or a decision date', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingLegislation(w);
    const fields = (await h.metadataOf(versionId)).map((row) => row.field).sort();
    expect(fields).toEqual(['instrument_number', 'jurisdiction', 'title']);
    await expect(h.verify(versionId, 'court')).rejects.toMatchObject({
      code: 'corpus.field_not_applicable',
    });
  });
});

// =============================================================================================
describe('a verification is of the exact value the reviewer saw', () => {
  it('refuses a fingerprint that is not the current value, so a stale or invented one cannot be recorded', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await expect(
      h.verify(versionId, 'title', { fingerprint: fieldFingerprint('title', 'A different title') }),
    ).rejects.toMatchObject({ code: 'corpus.verification_stale' });
    expect(
      await h.count(
        'SELECT count(*) AS n FROM corpus.version_field_verifications WHERE version_id = $1',
        [versionId],
      ),
    ).toBe(0);
  });

  it('separates fields: a fingerprint of the right text for the WRONG field is refused', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w, { docketNumber: 'SYNTHETIC-D1' });
    const title = (await h.metadataOf(versionId)).find((row) => row.field === 'title')?.value ?? '';
    await expect(
      h.verify(versionId, 'docket_number', { fingerprint: fieldFingerprint('title', title) }),
    ).rejects.toMatchObject({ code: 'corpus.verification_stale' });
  });

  it('has nothing to verify when the corpus records no value for the field', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w, 'none');
    await expect(
      h.verify(versionId, 'decision_date', { fingerprint: fieldFingerprint('decision_date', '') }),
    ).rejects.toMatchObject({ code: 'corpus.verification_stale' });
  });

  it('is invalidated when the value changes afterwards, and must be made again', async () => {
    const w = await h.world();
    const { versionId, documentId } = await h.pendingCase(w);
    await h.verifyAll(versionId);
    // Someone edits the title after it was checked.
    await h.asDataops((tx) =>
      tx.query('UPDATE corpus.legal_documents SET title = $2 WHERE id = $1', [
        documentId,
        '[SYNTHETIC] A different title',
      ]),
    );
    await expect(h.approve(versionId)).rejects.toMatchObject(REFUSED);
    await h.verify(versionId, 'title');
    await h.approve(versionId);
  });

  it('is governed by the LATEST record: a later rejection withdraws an earlier verification', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await h.verifyAll(versionId);
    await h.verify(versionId, 'court', { status: 'rejected', evidence: 'SYNTHETIC: wrong court' });
    await expect(h.approve(versionId)).rejects.toMatchObject(REFUSED);
    await h.verify(versionId, 'court'); // verified again
    await h.approve(versionId);
  });

  it('is only possible while the version awaits review', async () => {
    const w = await h.world();
    const ingesting = await h.draft(w);
    await expect(h.verify(ingesting.versionId, 'title')).rejects.toMatchObject({
      code: 'corpus.review_not_pending',
    });

    const approved = await h.pendingCase(w);
    await h.verifyAll(approved.versionId);
    await h.approve(approved.versionId);
    await expect(h.verify(approved.versionId, 'title')).rejects.toMatchObject({
      code: 'corpus.review_not_pending',
    });
  });
});

// =============================================================================================
describe('the verification record is append-only, human and time-stamped by the database', () => {
  it('cannot be updated, deleted or truncated by any runtime role', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await h.verify(versionId, 'title');
    for (const pool of [h.asDataops, h.asIngest, h.asApp]) {
      for (const sql of [
        `UPDATE corpus.version_field_verifications SET status = 'rejected' WHERE version_id = $1`,
        `UPDATE corpus.version_field_verifications SET verified_by = $2 WHERE version_id = $1`,
        `UPDATE corpus.version_field_verifications SET verified_at = '2000-01-01' WHERE version_id = $1`,
        'DELETE FROM corpus.version_field_verifications WHERE version_id = $1',
      ]) {
        await expect(
          pool((tx) =>
            tx.query(sql, sql.includes('$2') ? [versionId, h.staff.other] : [versionId]),
          ),
        ).rejects.toMatchObject({ code: '42501' });
      }
    }
  });

  it('cannot be rewritten even by a superuser: the trigger refuses', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await h.verify(versionId, 'title');
    for (const sql of [
      `UPDATE corpus.version_field_verifications SET verified_by = '${h.staff.other}'`,
      `UPDATE corpus.version_field_verifications SET verified_at = '2000-01-01'`,
      'DELETE FROM corpus.version_field_verifications',
      'TRUNCATE corpus.version_field_verifications',
    ]) {
      await expect(
        h.admin((c) => c.query(sql)),
        sql,
      ).rejects.toMatchObject({
        hint: 'corpus.append_only',
      });
    }
  });

  it('takes the time, the id and the recorded value from the database, never from the caller', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    const fingerprint = fieldFingerprint('title', '[SYNTHETIC] A v B');
    for (const extra of ['verified_at', 'value', 'id', 'sequence']) {
      await expect(
        h.asDataops((tx) =>
          tx.query(
            `INSERT INTO corpus.version_field_verifications
               (version_id, field, status, value_sha256, evidence_reference, verified_by, ${extra})
             VALUES ($1, 'title', 'verified', $2, 'SYNTHETIC evidence', $3, DEFAULT)`,
            [versionId, fingerprint, h.staff.verifier],
          ),
        ),
        extra,
      ).rejects.toMatchObject({ code: '42501' });
    }
    const before = Date.now();
    await h.verify(versionId, 'title');
    const row = (
      await h.admin((c) =>
        c.query<{ verified_at: Date; value: string }>(
          'SELECT verified_at, value FROM corpus.version_field_verifications WHERE version_id = $1',
          [versionId],
        ),
      )
    ).rows[0];
    expect(row?.value).toBe('[SYNTHETIC] A v B');
    expect(Math.abs((row?.verified_at.getTime() ?? 0) - before)).toBeLessThan(60_000);
  });

  it('must name a real person, and the evidence for what they checked', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await expect(
      h.verify(versionId, 'title', { by: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'corpus.reference_not_found' });
    for (const evidence of ['', '   ', 'x'.repeat(501)]) {
      await expect(h.verify(versionId, 'title', { evidence })).rejects.toBeDefined();
    }
  });

  it('cannot be recorded by the ingest role or the application role: a machine does not verify', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    const fingerprint = fieldFingerprint('title', '[SYNTHETIC] A v B');
    for (const pool of [h.asIngest, h.asApp]) {
      await expect(
        pool((tx) =>
          tx.query(
            `INSERT INTO corpus.version_field_verifications
               (version_id, field, status, value_sha256, evidence_reference, verified_by)
             VALUES ($1, 'title', 'verified', $2, 'SYNTHETIC evidence', $3)`,
            [versionId, fingerprint, h.staff.verifier],
          ),
        ),
        // The table privilege itself, not merely the function the trigger calls (a second layer).
      ).rejects.toMatchObject({
        code: '42501',
        message: tablePrivilege,
      });
    }
  });

  it('refuses a status outside the vocabulary, and a field outside the catalogue', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    const fingerprint = fieldFingerprint('title', '[SYNTHETIC] A v B');
    const insert = (field: string, status: string) =>
      h.asDataops((tx) =>
        tx.query(
          `INSERT INTO corpus.version_field_verifications
             (version_id, field, status, value_sha256, evidence_reference, verified_by)
           VALUES ($1, $2, $3, $4, 'SYNTHETIC evidence', $5)`,
          [versionId, field, status, fingerprint, h.staff.verifier],
        ),
      );
    await expect(insert('title', 'approved')).rejects.toMatchObject({ code: '23514' });
    // The trigger looks at the field first, so an unknown one is refused as "not applicable".
    await expect(insert('made_up_field', 'verified')).rejects.toSatisfy(
      (error: { code?: string; hint?: string }) =>
        error.code === '23514' || error.hint === 'corpus.field_not_applicable',
    );
  });
});

// =============================================================================================
describe('the rules that say what is critical are fixed by migration, not by anyone at runtime', () => {
  it('cannot be changed by any runtime role', async () => {
    for (const pool of [h.asDataops, h.asIngest, h.asApp]) {
      for (const sql of [
        "UPDATE corpus.critical_metadata_fields SET requirement = 'if_present'",
        'DELETE FROM corpus.critical_metadata_fields',
        "INSERT INTO corpus.critical_metadata_fields (document_type, field, requirement) VALUES ('case', 'title', 'required')",
      ]) {
        await expect(
          pool((tx) => tx.query(sql)),
          sql,
        ).rejects.toMatchObject({ code: '42501' });
      }
    }
  });

  it('cannot be changed even by a superuser: the rules are append-only', async () => {
    for (const sql of [
      "UPDATE corpus.critical_metadata_fields SET requirement = 'if_present' WHERE field = 'title'",
      'DELETE FROM corpus.critical_metadata_fields',
      'TRUNCATE corpus.critical_metadata_fields',
    ]) {
      await expect(
        h.admin((c) => c.query(sql)),
        sql,
      ).rejects.toMatchObject({
        hint: 'corpus.append_only',
      });
    }
  });
});

// =============================================================================================
describe('a correction after approval is a human act, and blocks publication until it is verified', () => {
  // Stage 3 decided that data-ops (people) may correct metadata on a reviewed document, while
  // ingestion (a machine) may not. That stays. What changes is that a correction can no longer
  // slip past unnoticed: the verification was of the OLD value, so publication is refused.
  it('lets data-ops correct the title, but the approved version can then no longer be published', async () => {
    const w = await h.world();
    const { versionId, documentId } = await h.pendingCase(w);
    await h.verifyAll(versionId);
    await h.approve(versionId);

    await h.asDataops((tx) =>
      tx.query('UPDATE corpus.legal_documents SET title = $2 WHERE id = $1', [
        documentId,
        '[SYNTHETIC] Corrected after approval',
      ]),
    );
    await expect(h.publish(versionId)).rejects.toMatchObject(REFUSED);
    // Re-verifying is only possible while a version awaits review, so it goes back through review.
    await expect(h.verify(versionId, 'title')).rejects.toMatchObject({
      code: 'corpus.review_not_pending',
    });
    expect(await h.stateOf(versionId)).toBe('approved');
  });

  it('never lets the ingest role change metadata that has been reviewed (row-level security, unchanged)', async () => {
    const w = await h.world();
    const { versionId, documentId } = await h.pendingCase(w);
    await h.verifyAll(versionId);
    await h.approve(versionId);
    const result = await h.asIngest((tx) =>
      tx.query(
        "UPDATE corpus.case_details SET decision_date = '2001-02-03' WHERE document_id = $1",
        [documentId],
      ),
    );
    expect(result.rowCount).toBe(0);
  });
});

// =============================================================================================
describe('publication re-checks the verification, so it cannot be bypassed', () => {
  it('refuses to publish an approved version whose metadata is not verified', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    // Arrange the impossible through the owner path: approval recorded while every trigger was off.
    await h.admin(async (c) => {
      await c.query('BEGIN');
      await c.query("SET LOCAL session_replication_role = 'replica'");
      await c.query(
        `UPDATE corpus.document_versions
            SET lifecycle_state = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`,
        [versionId, h.staff.reviewer],
      );
      await c.query('COMMIT');
    });
    expect(await h.stateOf(versionId)).toBe('approved');
    await expect(h.publish(versionId)).rejects.toMatchObject(REFUSED);
    expect(await h.stateOf(versionId)).toBe('approved');
  });

  it('publishes a properly verified and approved version', async () => {
    const w = await h.world();
    const { versionId } = await h.pendingCase(w);
    await h.verifyAll(versionId);
    await h.approve(versionId);
    await h.publish(versionId);
    expect(await h.stateOf(versionId)).toBe('published');
  });
});

// =============================================================================================
describe('the gate fails closed', () => {
  it('refuses a document type whose rules are missing from the catalogue, rather than waving it through', async () => {
    const w = await h.world();
    const { versionId } = await h.draft(w, { type: 'commentary', title: '[SYNTHETIC] Commentary' });
    await h.submit(versionId);
    // A kind of document added without its rules: remove them through the owner path.
    await h.admin(async (c) => {
      await c.query(
        'ALTER TABLE corpus.critical_metadata_fields DISABLE TRIGGER critical_fields_no_delete',
      );
      await c.query(
        "DELETE FROM corpus.critical_metadata_fields WHERE document_type = 'commentary'",
      );
      await c.query(
        'ALTER TABLE corpus.critical_metadata_fields ENABLE TRIGGER critical_fields_no_delete',
      );
    });
    try {
      expect(await h.metadataOf(versionId)).toEqual([]);
      await expect(h.approve(versionId)).rejects.toMatchObject(REFUSED);
      expect(await h.stateOf(versionId)).toBe('pending_review');
    } finally {
      await h.admin((c) =>
        c.query(
          `INSERT INTO corpus.critical_metadata_fields (document_type, field, requirement)
           VALUES ('commentary', 'title', 'required'), ('commentary', 'jurisdiction', 'required')`,
        ),
      );
    }
  });

  it('refuses a version that does not exist rather than reporting nothing to verify', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const result = await h.admin((c) =>
      c.query<{ unverified: string[] }>(
        'SELECT corpus.unverified_critical_fields($1) AS unverified',
        [unknown],
      ),
    );
    expect(result.rows[0]?.unverified).toEqual(['title']);
  });
});

// =============================================================================================
describe('the rules are written down once: TypeScript and the database agree', () => {
  it('lists the same critical fields, per document type, with the same requirement', async () => {
    const rows = await h.admin((c) =>
      c.query<{ document_type: string; field: string; requirement: string }>(
        'SELECT document_type, field, requirement FROM corpus.critical_metadata_fields',
      ),
    );
    const fromDatabase = rows.rows
      .map((r) => `${r.document_type}:${r.field}:${r.requirement}`)
      .sort();
    const fromTypescript = Object.entries(CRITICAL_FIELDS)
      .flatMap(([type, fields]) => fields.map((f) => `${type}:${f.field}:${f.requirement}`))
      .sort();
    expect(fromDatabase).toEqual(fromTypescript);
  });

  it('every document type is covered, so none escapes the gate', async () => {
    const types = await h.admin((c) =>
      c.query<{ allowed: string }>(
        `SELECT pg_get_constraintdef(oid) AS allowed FROM pg_constraint
          WHERE conrelid = 'corpus.legal_documents'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%document_type%'`,
      ),
    );
    const documentTypes = [...(types.rows[0]?.allowed ?? '').matchAll(/'([a-z_]+)'::text/g)].map(
      (m) => m[1] ?? '',
    );
    expect(documentTypes.length).toBeGreaterThan(0);
    for (const type of documentTypes) {
      const fields = (CRITICAL_FIELDS as Record<string, readonly { field: string }[]>)[type] ?? [];
      expect(
        fields.map((f) => f.field),
        type,
      ).toEqual(expect.arrayContaining(['title', 'jurisdiction']));
    }
  });

  it('uses the same field and status vocabularies', async () => {
    const literals = async (column: string) =>
      (
        await h.admin((c) =>
          c.query<{ def: string }>(
            `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = 'corpus.version_field_verifications'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) LIKE $1`,
            [`%${column}%`],
          ),
        )
      ).rows.flatMap((row) => [...row.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1] ?? ''));
    expect((await literals('field')).sort()).toEqual([...METADATA_FIELDS].sort());
    expect((await literals('status')).sort()).toEqual([...VERIFICATION_STATUSES].sort());
  });

  it.each([
    ['title', 'Alpha v Beta'],
    ['title', 'Ünïcödé — “quoted” 判決  -free'.replace(' ', '')],
    ['jurisdiction', 'ZZ-1'],
    ['decision_date', '2000-01-01'],
    ['court', 'SYNTHETIC High Court'],
    ['neutral_citation', '[SYNTHETIC 2000] X 1'],
  ] as const)(
    'fingerprints %s the same way in TypeScript and in SQL (%s)',
    async (field, value) => {
      const sql = await h.admin((c) =>
        c.query<{ fingerprint: Buffer }>('SELECT corpus.field_fingerprint($1, $2) AS fingerprint', [
          field,
          value,
        ]),
      );
      expect(sql.rows[0]?.fingerprint.equals(fieldFingerprint(field, value))).toBe(true);
    },
  );

  it('keeps fields apart: the same text fingerprints differently under two field names', () => {
    expect(fieldFingerprint('title', 'X').equals(fieldFingerprint('court', 'X'))).toBe(false);
  });
});
