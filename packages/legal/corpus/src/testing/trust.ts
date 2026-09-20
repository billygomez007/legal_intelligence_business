import { withPublicTransaction, type DbPool } from '@legalintel/db';

import { corpusStore } from '../adapters/pg-corpus-store';
import type { VersionId } from '../domain/ids';
import { fieldFingerprint } from '../domain/verification';

/**
 * Does what a diligent reviewer does for a version that is awaiting review, so a test (or a
 * synthetic seed) can go on to approve it: records the case details a case needs if the corpus
 * holds none (a court and a decision date, as a person would copy them from the source), then
 * verifies every critical field the corpus holds a value for.
 *
 * It is a test helper: the point of the approval gate is that production code cannot do this on
 * its own. A version that is not awaiting review is left alone, so a test of what happens then
 * still sees the database's own refusal. Data-ops role.
 */
export async function verifyForApproval(
  pools: { readonly dataops: DbPool },
  versionId: VersionId,
  verifiedBy: string,
): Promise<void> {
  await withPublicTransaction(pools.dataops, async (tx) => {
    const found = await tx.query<{
      state: string;
      document_id: string;
      jurisdiction_id: string;
      type: string;
    }>(
      `SELECT v.lifecycle_state AS state, v.document_id, v.jurisdiction_id, d.document_type AS type
         FROM corpus.document_versions v JOIN corpus.legal_documents d ON d.id = v.document_id
        WHERE v.id = $1`,
      [versionId],
    );
    const version = found.rows[0];
    if (version?.state !== 'pending_review') return;

    if (version.type === 'case') {
      const court = await tx.query<{ id: string }>(
        'SELECT id FROM corpus.courts WHERE jurisdiction_id = $1 ORDER BY created_at LIMIT 1',
        [version.jurisdiction_id],
      );
      const courtId =
        court.rows[0]?.id ??
        (
          await tx.query<{ id: string }>(
            `INSERT INTO corpus.courts (jurisdiction_id, name, level, authority_rank)
           VALUES ($1, 'SYNTHETIC court', 1, 1) RETURNING id`,
            [version.jurisdiction_id],
          )
        ).rows[0]?.id;
      await tx.query(
        `INSERT INTO corpus.case_details (document_id, jurisdiction_id, court_id, decision_date)
         VALUES ($1, $2, $3, '2000-01-01')
         ON CONFLICT (document_id) DO UPDATE
           SET decision_date = coalesce(corpus.case_details.decision_date, '2000-01-01')`,
        [version.document_id, version.jurisdiction_id, courtId],
      );
    }

    for (const row of await corpusStore.criticalMetadata(tx, versionId)) {
      if (row.value === null) continue;
      await corpusStore.recordFieldVerification(tx, {
        versionId,
        field: row.field,
        status: 'verified',
        valueSha256: fieldFingerprint(row.field, row.value),
        evidenceReference: 'SYNTHETIC: checked against the synthetic source',
        verifiedBy,
      });
    }
  });
}

/**
 * Runs SQL as the database owner or a superuser. The corpus test database hands one out; see
 * `attestForTests` for why a test needs it.
 */
export type AdminQuery = (sql: string, params?: readonly unknown[]) => Promise<unknown>;

/**
 * Records a provenance attestation for a version, standing in for ingestion's checked function
 * (`ingestion.attest_provenance`, ingestion migration 0002). No runtime role may write an
 * attestation, so a corpus-only test or seed reaches for the owner path. The database still
 * applies its own rules: the attestation must describe the version (source, content, pipeline
 * version) and is stamped by the database. Idempotent.
 */
export async function attestForTests(admin: AdminQuery, versionId: VersionId): Promise<void> {
  await admin(
    `INSERT INTO corpus.version_provenance_attestations
       (version_id, source_id, content_checksum, pipeline_version, attestation_type,
        attestation_version, evidence_reference, system_identity)
     SELECT id, source_id, content_checksum, pipeline_version, 'ingestion_pipeline', 1,
            'SYNTHETIC: test attestation', 'synthetic-test'
       FROM corpus.document_versions WHERE id = $1
     ON CONFLICT (version_id, attestation_type, attestation_version) DO NOTHING`,
    [versionId],
  );
}
