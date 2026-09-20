import { platformMigrations, withPublicTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  corpusMigrations,
  corpusStore,
  sha256,
  type DocumentId,
  type JurisdictionId,
  type SourceId,
  type VersionId,
} from '../src';

/**
 * Integrity controls added after the independent review of Stages 0-5: succession of versions,
 * verification of publish-critical metadata, and provenance attestation. Each test attacks the
 * database as a real runtime role.
 */
let database: TestDatabase;
let ingest: DbPool;
let dataops: DbPool;
let admin: TestDatabase['withAdmin'];

type Tx = Parameters<Parameters<typeof withPublicTransaction>[1]>[0];
const asIngest = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(ingest, fn);
const asDataops = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(dataops, fn);

beforeAll(async () => {
  database = await createTestDatabase({
    migrationSets: [platformMigrations, iamMigrations, corpusMigrations],
  });
  ingest = database.poolFor('ingest');
  dataops = database.poolFor('dataops');
  admin = (fn) => database.withAdmin(fn);
});

afterAll(async () => {
  await database.dispose();
});

let sequence = 0;
const unique = (label: string) => `${label}-${Date.now().toString(36)}-${(sequence += 1)}`;

async function world() {
  return asDataops(async (tx) => {
    const jurisdictionId = await corpusStore.createJurisdiction(tx, {
      code: `ZZ-${(sequence += 1).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      name: unique('SYNTHETIC jurisdiction'),
      kind: 'country',
      isSynthetic: true,
    });
    const sourceId = await corpusStore.registerSource(tx, {
      jurisdictionId,
      name: unique('SYNTHETIC source'),
      kind: 'publisher',
    });
    return { jurisdictionId, sourceId };
  });
}

interface World {
  jurisdictionId: JurisdictionId;
  sourceId: SourceId;
}

const newDocument = (w: World, title = '[SYNTHETIC] A v B') =>
  asIngest((tx) =>
    corpusStore.createDocument(tx, {
      jurisdictionId: w.jurisdictionId,
      documentType: 'case',
      title,
    }),
  );

const newVersion = (
  w: World,
  documentId: DocumentId,
  versionNumber: number,
  supersedes?: VersionId,
) =>
  asIngest((tx) =>
    corpusStore.createVersion(tx, {
      documentId,
      jurisdictionId: w.jurisdictionId,
      versionNumber,
      sourceId: w.sourceId,
      acquiredAt: new Date(),
      contentChecksum: sha256(unique('bytes')),
      storageKey: `synthetic/${unique('k')}`,
      pipelineVersion: 'test-1',
      ...(supersedes === undefined ? {} : { supersedesVersionId: supersedes }),
    }),
  );

const supersedesOf = async (versionId: VersionId) =>
  (
    await admin((c) =>
      c.query<{ supersedes_version_id: string | null }>(
        'SELECT supersedes_version_id FROM corpus.document_versions WHERE id = $1',
        [versionId],
      ),
    )
  ).rows[0]?.supersedes_version_id;

// =============================================================================================
describe('a version may supersede only an earlier version of the SAME document', () => {
  it('lets version 2 of a document supersede version 1 of that document', async () => {
    const w = await world();
    const documentId = await newDocument(w);
    const first = await newVersion(w, documentId, 1);
    const second = await newVersion(w, documentId, 2, first);
    expect(await supersedesOf(second)).toBe(first);
  });

  it('lets a chain of versions of one document each supersede the last', async () => {
    const w = await world();
    const documentId = await newDocument(w);
    const v1 = await newVersion(w, documentId, 1);
    const v2 = await newVersion(w, documentId, 2, v1);
    const v3 = await newVersion(w, documentId, 3, v2);
    expect(await supersedesOf(v3)).toBe(v2);
  });

  it('refuses version 1 of document B superseding version 1 of document A', async () => {
    const w = await world();
    const documentA = await newDocument(w, '[SYNTHETIC] Document A');
    const documentB = await newDocument(w, '[SYNTHETIC] Document B');
    const versionOfA = await newVersion(w, documentA, 1);
    await expect(newVersion(w, documentB, 1, versionOfA)).rejects.toMatchObject({
      code: 'corpus.supersession_invalid',
    });
    // Nothing was created: document B still has no version.
    const rows = await admin((c) =>
      c.query('SELECT 1 FROM corpus.document_versions WHERE document_id = $1', [documentB]),
    );
    expect(rows.rowCount).toBe(0);
  });

  it('refuses it in raw SQL too, naming the constraint that says so', async () => {
    const w = await world();
    const documentA = await newDocument(w);
    const documentB = await newDocument(w);
    const versionOfA = await newVersion(w, documentA, 1);
    await expect(
      asIngest((tx) =>
        tx.query(
          `INSERT INTO corpus.document_versions
             (document_id, jurisdiction_id, version_number, source_id, acquired_at,
              content_checksum, storage_key, pipeline_version, supersedes_version_id)
           VALUES ($1, $2, 1, $3, now(), $4, 'k', 'test-1', $5)`,
          [documentB, w.jurisdictionId, w.sourceId, sha256(unique('raw')), versionOfA],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'document_versions_supersedes_same_document',
    });
  });

  it('refuses a version that supersedes a version that does not exist', async () => {
    const w = await world();
    const documentId = await newDocument(w);
    await expect(
      newVersion(w, documentId, 1, '00000000-0000-4000-8000-000000000000' as VersionId),
    ).rejects.toMatchObject({ code: 'corpus.supersession_invalid' });
  });

  it('refuses a version that supersedes itself', async () => {
    const w = await world();
    const documentId = await newDocument(w);
    const id = '11111111-1111-4111-8111-111111111111';
    await expect(
      asIngest((tx) =>
        tx.query(
          `INSERT INTO corpus.document_versions
             (id, document_id, jurisdiction_id, version_number, source_id, acquired_at,
              content_checksum, storage_key, pipeline_version, supersedes_version_id)
           VALUES ($1, $2, $3, 1, $4, now(), $5, 'k', 'test-1', $1)`,
          [id, documentId, w.jurisdictionId, w.sourceId, sha256(unique('self'))],
        ),
      ),
    ).rejects.toMatchObject({ constraint: 'document_versions_not_self_superseding' });
  });

  it('keeps the link immutable after creation, for the runtime role and for the owner path', async () => {
    const w = await world();
    const documentId = await newDocument(w);
    const v1 = await newVersion(w, documentId, 1);
    const v2 = await newVersion(w, documentId, 2);
    // The runtime role has no privilege to touch the column at all ...
    await expect(
      asIngest((tx) =>
        tx.query('UPDATE corpus.document_versions SET supersedes_version_id = $2 WHERE id = $1', [
          v2,
          v1,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // ... and even a superuser is refused by the lifecycle trigger: provenance never changes.
    await expect(
      admin((c) =>
        c.query('UPDATE corpus.document_versions SET supersedes_version_id = $2 WHERE id = $1', [
          v2,
          v1,
        ]),
      ),
    ).rejects.toMatchObject({ hint: 'corpus.version_immutable' });
    expect(await supersedesOf(v2)).toBeNull();
  });

  it('is version succession, not a legal relationship: the graph is where documents relate', async () => {
    const w = await world();
    const documentA = await newDocument(w);
    const documentB = await newDocument(w);
    const versionOfA = await newVersion(w, documentA, 1);
    const versionOfB = await newVersion(w, documentB, 1);
    // Document B legitimately "supersedes" document A as a legal relationship: the edge lives in
    // graph.citations (relationship_type = 'supersedes'), between DOCUMENTS, with evidence.
    const types = await admin((c) =>
      c.query<{ type: string }>(
        `SELECT type FROM graph.relationship_types WHERE type = 'supersedes'`,
      ),
    );
    expect(types.rows).toHaveLength(1);
    expect(versionOfA).not.toBe(versionOfB);
  });
});
