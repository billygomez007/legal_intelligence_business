import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, syntheticDocument, unique, type Harness } from './harness';

/**
 * Every version the pipeline hands to review is attested by the pipeline, in the same
 * transaction, from the evidence it verified. The corpus will not approve or publish a version
 * without that record, so it is what connects "ingestion checked this" to "the corpus will
 * accept it" without the corpus reading any ingestion table.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.dispose();
});

interface Attestation {
  version_id: string;
  source_id: string;
  content_checksum: Buffer;
  pipeline_version: string;
  attestation_type: string;
  attestation_version: number;
  evidence_reference: string;
  system_identity: string;
  actor_id: string | null;
  attested_at: Date;
}

const handedOff = async () => {
  const w = await h.world();
  const job = await h.ingestDocument(
    w,
    syntheticDocument(unique('Attested Act'), { identifier: unique('SYN/ATT') }),
  );
  expect(job.status).toBe('pending_review');
  const [attestation] = await h.q<Attestation & Record<string, unknown>>(
    'SELECT * FROM corpus.version_provenance_attestations WHERE version_id = $1',
    [job.versionId],
  );
  return { w, job, attestation };
};

describe('the pipeline attests what it hands to review', () => {
  it('writes one attestation per handed-off version, describing exactly that version', async () => {
    const { w, job, attestation } = await handedOff();
    const [artifact] = await h.q<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM ingestion.artifacts WHERE id = $1',
      [job.artifactId],
    );
    expect(attestation).toBeDefined();
    expect(attestation?.version_id).toBe(job.versionId);
    expect(attestation?.source_id).toBe(w.sourceId);
    expect(attestation?.content_checksum.toString('hex')).toBe(artifact?.checksum);
    expect(attestation?.pipeline_version).toBe('ingestion/1');
    expect(attestation).toMatchObject({
      attestation_type: 'ingestion_pipeline',
      attestation_version: 1,
      system_identity: 'ingestion-pipeline',
    });
  });

  it('records who asked for the acquisition, and points at the evidence it checked', async () => {
    const { job, attestation } = await handedOff();
    expect(attestation?.actor_id).toBe(h.staff.operator);
    const [extraction] = await h.q<{ text_checksum: string }>(
      'SELECT text_checksum FROM ingestion.extractions WHERE job_id = $1',
      [job.id],
    );
    expect(attestation?.evidence_reference).toContain(`job=${job.id}`);
    expect(attestation?.evidence_reference).toContain(`artifact=${job.artifactId}`);
    expect(attestation?.evidence_reference).toContain(`text=${extraction?.text_checksum}`);
  });

  it('stamps the time itself, close to now', async () => {
    const { attestation } = await handedOff();
    expect(Date.now() - (attestation?.attested_at.getTime() ?? 0)).toBeLessThan(120_000);
  });

  it('attests nothing for a job that stopped: a duplicate or an unsupported format has no version', async () => {
    const w = await h.world();
    const before = await h.q<{ n: string }>(
      'SELECT count(*) AS n FROM corpus.version_provenance_attestations WHERE source_id = $1',
      [w.sourceId],
    );
    const stopped = await h.ingestDocument(w, 'no text layer', { mediaType: 'application/pdf' });
    expect(stopped.status).toBe('needs_review');
    const after = await h.q<{ n: string }>(
      'SELECT count(*) AS n FROM corpus.version_provenance_attestations WHERE source_id = $1',
      [w.sourceId],
    );
    expect(after).toEqual(before);
  });

  it('is what lets a person approve: with it and verified metadata the corpus accepts the version', async () => {
    const { job } = await handedOff();
    const taskId = await h.taskFor(job.id);
    await h.verifyCritical(taskId);
    await h.review().decide(h.reviewer(), { taskId, decision: 'approve', reasonCode: 'checked' });
    const [version] = await h.q<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM corpus.document_versions WHERE id = $1',
      [job.versionId],
    );
    expect(version?.lifecycle_state).toBe('approved');
  });

  it('cannot be changed afterwards, by the ingest role or a superuser', async () => {
    const { job } = await handedOff();
    await expect(
      h.asIngest((tx) =>
        tx.query("UPDATE corpus.version_provenance_attestations SET system_identity = 'x'"),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      h.database.withAdmin((c) =>
        c.query('DELETE FROM corpus.version_provenance_attestations WHERE version_id = $1', [
          job.versionId,
        ]),
      ),
    ).rejects.toMatchObject({ hint: 'corpus.append_only' });
  });
});
