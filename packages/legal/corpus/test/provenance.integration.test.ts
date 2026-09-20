import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256 } from '../src';
import { createHarness, type Harness } from './harness';

/**
 * A version is approved (and published) only if its provenance has been attested. The
 * attestation is a corpus-owned, append-only record that ingestion writes after ITS evidence
 * checks pass (ingestion migration 0002); the corpus can require it without reading any
 * ingestion table. These tests attack the corpus side, as each runtime role and as the owner.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

const REQUIRED = { code: 'corpus.provenance_required' };

/** Fully verified metadata, so the only thing missing is the attestation. */
async function verifiedCase() {
  const w = await h.world();
  const drafted = await h.pendingCase(w);
  await h.verifyAll(drafted.versionId);
  return { w, ...drafted };
}

interface Attestation {
  id: string;
  version_id: string;
  source_id: string;
  content_checksum: Buffer;
  pipeline_version: string;
  attestation_type: string;
  attestation_version: number;
  system_identity: string;
  attested_at: Date;
}
const attestationsOf = async (versionId: string) =>
  (
    await h.admin((c) =>
      c.query<Attestation>(
        'SELECT * FROM corpus.version_provenance_attestations WHERE version_id = $1',
        [versionId],
      ),
    )
  ).rows;

// =============================================================================================
describe('a version cannot be approved without an attestation of its provenance', () => {
  it('refuses approval when nothing has attested where the version came from', async () => {
    const { versionId } = await verifiedCase();
    await expect(h.approve(versionId, undefined, { attest: false })).rejects.toMatchObject(
      REQUIRED,
    );
    expect(await h.stateOf(versionId)).toBe('pending_review');
    expect(
      await h.count(
        'SELECT count(*) AS n FROM corpus.version_review_decisions WHERE version_id = $1',
        [versionId],
      ),
    ).toBe(0);
  });

  it('approves once a matching attestation exists', async () => {
    const { versionId } = await verifiedCase();
    await h.attest(versionId);
    await h.approve(versionId, undefined, { attest: false });
    expect(await h.stateOf(versionId)).toBe('approved');
  });

  it('needs BOTH the attestation and the verified metadata: neither substitutes for the other', async () => {
    const w = await h.world();
    const attestedOnly = await h.pendingCase(w);
    await h.attest(attestedOnly.versionId);
    await expect(
      h.approve(attestedOnly.versionId, undefined, { attest: false }),
    ).rejects.toMatchObject({
      code: 'corpus.metadata_unverified',
    });

    const verifiedOnly = await h.pendingCase(w);
    await h.verifyAll(verifiedOnly.versionId);
    await expect(
      h.approve(verifiedOnly.versionId, undefined, { attest: false }),
    ).rejects.toMatchObject(REQUIRED);
  });

  it('is asked of every version: an attestation for one version does not cover another', async () => {
    const w = await h.world();
    const first = await h.pendingCase(w);
    const second = await h.pendingCase(w);
    await h.verifyAll(first.versionId);
    await h.verifyAll(second.versionId);
    await h.attest(first.versionId);
    await h.approve(first.versionId, undefined, { attest: false });
    await expect(h.approve(second.versionId, undefined, { attest: false })).rejects.toMatchObject(
      REQUIRED,
    );
  });
});

// =============================================================================================
describe('an attestation must describe the version it is for', () => {
  const forge = (fields: {
    versionId: string;
    sourceId: string;
    checksum: Buffer;
    pipeline: string;
  }) =>
    h.admin((c) =>
      c.query(
        `INSERT INTO corpus.version_provenance_attestations
           (version_id, source_id, content_checksum, pipeline_version, attestation_type,
            attestation_version, evidence_reference, system_identity)
         VALUES ($1, $2, $3, $4, 'ingestion_pipeline', 1, 'SYNTHETIC', 'synthetic-test')`,
        [fields.versionId, fields.sourceId, fields.checksum, fields.pipeline],
      ),
    );

  const facts = async (versionId: string) =>
    (
      await h.admin((c) =>
        c.query<{ source_id: string; content_checksum: Buffer; pipeline_version: string }>(
          'SELECT source_id, content_checksum, pipeline_version FROM corpus.document_versions WHERE id = $1',
          [versionId],
        ),
      )
    ).rows[0] ?? { source_id: '', content_checksum: Buffer.alloc(0), pipeline_version: '' };

  it('refuses a forged attestation naming another source', async () => {
    const { versionId } = await verifiedCase();
    const real = await facts(versionId);
    const other = await h.world();
    await expect(
      forge({
        versionId,
        sourceId: other.sourceId,
        checksum: real.content_checksum,
        pipeline: real.pipeline_version,
      }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'attestation_matches_version' });
  });

  it('refuses a forged attestation naming other content', async () => {
    const { versionId } = await verifiedCase();
    const real = await facts(versionId);
    await expect(
      forge({
        versionId,
        sourceId: real.source_id,
        checksum: sha256('bytes that are not the version'),
        pipeline: real.pipeline_version,
      }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'attestation_matches_version' });
  });

  it('refuses a forged attestation naming another pipeline version', async () => {
    const { versionId } = await verifiedCase();
    const real = await facts(versionId);
    await expect(
      forge({
        versionId,
        sourceId: real.source_id,
        checksum: real.content_checksum,
        pipeline: 'some-other-pipeline/9',
      }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'attestation_matches_version' });
  });

  it('refuses an attestation for a version that does not exist', async () => {
    const w = await h.world();
    await expect(
      forge({
        versionId: '00000000-0000-4000-8000-000000000000',
        sourceId: w.sourceId,
        checksum: sha256('x'),
        pipeline: 'test-1',
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts one that matches, and leaves the forged attempts behind no trace', async () => {
    const { versionId } = await verifiedCase();
    const real = await facts(versionId);
    await expect(
      forge({
        versionId,
        sourceId: real.source_id,
        checksum: sha256('wrong'),
        pipeline: real.pipeline_version,
      }),
    ).rejects.toBeDefined();
    expect(await attestationsOf(versionId)).toHaveLength(0);
    await forge({
      versionId,
      sourceId: real.source_id,
      checksum: real.content_checksum,
      pipeline: real.pipeline_version,
    });
    expect(await attestationsOf(versionId)).toHaveLength(1);
  });

  it('is unique per version, type and attestation version: it cannot be recorded twice', async () => {
    const { versionId } = await verifiedCase();
    await h.attest(versionId);
    const again = () =>
      h.admin((c) =>
        c.query(
          `INSERT INTO corpus.version_provenance_attestations
             (version_id, source_id, content_checksum, pipeline_version, attestation_type,
              attestation_version, evidence_reference, system_identity)
           SELECT id, source_id, content_checksum, pipeline_version, 'ingestion_pipeline', 1,
                  'SYNTHETIC', 'synthetic-test'
             FROM corpus.document_versions WHERE id = $1`,
          [versionId],
        ),
      );
    await expect(again()).rejects.toMatchObject({ code: '23505' });
  });

  it('only knows the attestation types the corpus recognises', async () => {
    const { versionId } = await verifiedCase();
    const real = await facts(versionId);
    await expect(
      h.admin((c) =>
        c.query(
          `INSERT INTO corpus.version_provenance_attestations
             (version_id, source_id, content_checksum, pipeline_version, attestation_type,
              attestation_version, evidence_reference, system_identity)
           VALUES ($1, $2, $3, $4, 'self_declared', 1, 'SYNTHETIC', 'synthetic-test')`,
          [versionId, real.source_id, real.content_checksum, real.pipeline_version],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// =============================================================================================
describe('the attestation record is written by the database and can never be changed', () => {
  it('takes its time from the database, and names who attested', async () => {
    const { versionId } = await verifiedCase();
    const before = Date.now();
    await h.attest(versionId);
    const [row] = await attestationsOf(versionId);
    expect(row?.system_identity).toBe('synthetic-test');
    expect(Math.abs((row?.attested_at.getTime() ?? 0) - before)).toBeLessThan(60_000);
  });

  it('cannot be backdated even by the owner path: the trigger assigns the time', async () => {
    const { versionId } = await verifiedCase();
    await h.admin((c) =>
      c.query(
        `INSERT INTO corpus.version_provenance_attestations
           (version_id, source_id, content_checksum, pipeline_version, attestation_type,
            attestation_version, evidence_reference, system_identity, attested_at)
         SELECT id, source_id, content_checksum, pipeline_version, 'ingestion_pipeline', 1,
                'SYNTHETIC', 'synthetic-test', '2000-01-01T00:00:00Z'
           FROM corpus.document_versions WHERE id = $1`,
        [versionId],
      ),
    );
    const [row] = await attestationsOf(versionId);
    expect(Date.now() - (row?.attested_at.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it('is immutable: no update, delete or truncate, by any runtime role or a superuser', async () => {
    const { versionId } = await verifiedCase();
    await h.attest(versionId);
    for (const pool of [h.asDataops, h.asIngest, h.asApp]) {
      for (const sql of [
        `UPDATE corpus.version_provenance_attestations SET system_identity = 'x' WHERE version_id = $1`,
        'DELETE FROM corpus.version_provenance_attestations WHERE version_id = $1',
      ]) {
        await expect(pool((tx) => tx.query(sql, [versionId]))).rejects.toMatchObject({
          code: '42501',
        });
      }
    }
    for (const sql of [
      `UPDATE corpus.version_provenance_attestations SET version_id = version_id`,
      `UPDATE corpus.version_provenance_attestations SET evidence_reference = 'rewritten'`,
      'DELETE FROM corpus.version_provenance_attestations',
      'TRUNCATE corpus.version_provenance_attestations',
    ]) {
      await expect(
        h.admin((c) => c.query(sql)),
        sql,
      ).rejects.toMatchObject({
        hint: 'corpus.append_only',
      });
    }
    expect(await attestationsOf(versionId)).toHaveLength(1);
  });

  it('cannot be written by any runtime role: ingestion attests through its own checked function', async () => {
    const { versionId } = await verifiedCase();
    const real = (
      await h.admin((c) =>
        c.query<{ source_id: string; content_checksum: Buffer; pipeline_version: string }>(
          'SELECT source_id, content_checksum, pipeline_version FROM corpus.document_versions WHERE id = $1',
          [versionId],
        ),
      )
    ).rows[0];
    for (const pool of [h.asIngest, h.asDataops, h.asApp]) {
      await expect(
        pool((tx) =>
          tx.query(
            `INSERT INTO corpus.version_provenance_attestations
               (version_id, source_id, content_checksum, pipeline_version, attestation_type,
                attestation_version, evidence_reference, system_identity)
             VALUES ($1, $2, $3, $4, 'ingestion_pipeline', 1, 'FABRICATED', 'ingestion-pipeline')`,
            [versionId, real?.source_id, real?.content_checksum, real?.pipeline_version],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    expect(await attestationsOf(versionId)).toHaveLength(0);
  });

  it('is readable by the roles that review, and by no application role', async () => {
    const { versionId } = await verifiedCase();
    await h.attest(versionId);
    const rows = await h.asDataops((tx) =>
      tx.query('SELECT 1 FROM corpus.version_provenance_attestations WHERE version_id = $1', [
        versionId,
      ]),
    );
    expect(rows.rowCount).toBe(1);
    await expect(
      h.asApp((tx) => tx.query('SELECT 1 FROM corpus.version_provenance_attestations')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

// =============================================================================================
describe('publication cannot bypass the approval and provenance chain', () => {
  const approveByForce = (versionId: string) =>
    h.admin(async (c) => {
      await c.query('BEGIN');
      await c.query("SET LOCAL session_replication_role = 'replica'");
      await c.query(
        `UPDATE corpus.document_versions
            SET lifecycle_state = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`,
        [versionId, h.staff.reviewer],
      );
      await c.query('COMMIT');
    });

  it('refuses to publish an approved version that no one attested', async () => {
    const { versionId } = await verifiedCase();
    await approveByForce(versionId); // an approval recorded with every trigger off
    expect(await h.stateOf(versionId)).toBe('approved');
    await expect(h.publish(versionId)).rejects.toMatchObject(REQUIRED);
    expect(await h.stateOf(versionId)).toBe('approved');
  });

  it('cannot publish straight from review, whoever asks', async () => {
    const { versionId } = await verifiedCase();
    await h.attest(versionId);
    await expect(h.publish(versionId)).rejects.toMatchObject({ code: 'corpus.invalid_transition' });
    await expect(
      h.admin((c) =>
        c.query(
          "UPDATE corpus.document_versions SET lifecycle_state = 'published', published_by = $2 WHERE id = $1",
          [versionId, h.staff.publisher],
        ),
      ),
    ).rejects.toMatchObject({ hint: 'corpus.invalid_transition' });
  });

  it('publishes a version that was verified, attested and approved by a different person', async () => {
    const { versionId } = await verifiedCase();
    await h.attest(versionId);
    await h.approve(versionId, undefined, { attest: false });
    await h.publish(versionId);
    expect(await h.stateOf(versionId)).toBe('published');
  });
});

// =============================================================================================
describe('ingestion cannot fabricate an approved corpus state', () => {
  it('cannot approve, publish, attest or verify on its own, in any combination', async () => {
    const { versionId } = await verifiedCase();
    for (const sql of [
      "UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1",
      "UPDATE corpus.document_versions SET lifecycle_state = 'published', published_by = $2 WHERE id = $1",
    ]) {
      await expect(
        h.asIngest((tx) => tx.query(sql, [versionId, h.staff.reviewer])),
      ).rejects.toMatchObject({
        code: '42501',
      });
    }
    expect(await h.stateOf(versionId)).toBe('pending_review');
  });
});
