import { platformMigrations, withPublicTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';

import {
  corpusMigrations,
  corpusStore,
  fieldFingerprint,
  sha256,
  type CourtId,
  type DocumentId,
  type DocumentType,
  type JurisdictionId,
  type MetadataField,
  type SourceId,
  type VerificationStatus,
  type VersionId,
} from '../src';

/**
 * A corpus database with the runtime roles, staff users and helpers for building versions in
 * the states the integrity tests need. Everything is labelled SYNTHETIC.
 */
export type Tx = Parameters<Parameters<typeof withPublicTransaction>[1]>[0];

export interface World {
  jurisdictionId: JurisdictionId;
  sourceId: SourceId;
}

export interface Drafted {
  documentId: DocumentId;
  versionId: VersionId;
}

export interface CaseDetails {
  courtId?: CourtId;
  decisionDate?: string;
  neutralCitation?: string;
  docketNumber?: string;
}

export async function createHarness() {
  const database: TestDatabase = await createTestDatabase({
    migrationSets: [platformMigrations, iamMigrations, corpusMigrations],
  });
  const ingest: DbPool = database.poolFor('ingest');
  const dataops: DbPool = database.poolFor('dataops');
  const app: DbPool = database.poolFor('app');
  const admin: TestDatabase['withAdmin'] = (fn) => database.withAdmin(fn);

  const asIngest = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(ingest, fn);
  const asDataops = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(dataops, fn);
  const asApp = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(app, fn);

  const staff = { rights: '', reviewer: '', publisher: '', verifier: '', other: '' };
  for (const key of Object.keys(staff) as (keyof typeof staff)[]) {
    const result = await admin((c) =>
      c.query<{ id: string }>(
        `INSERT INTO iam.users (email, display_name) VALUES ($1, $2) RETURNING id`,
        [`${key}@staff.example.test`, key],
      ),
    );
    staff[key] = result.rows[0]?.id ?? '';
  }

  let sequence = 0;
  const unique = (label: string) => `${label}-${Date.now().toString(36)}-${(sequence += 1)}`;

  async function world(rights: 'cleared' | 'none' = 'cleared'): Promise<World> {
    const created = await asDataops(async (tx) => {
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
      if (rights === 'cleared') {
        await corpusStore.recordRightsDecision(tx, {
          sourceId,
          status: 'approved',
          allowedUses: ['display', 'index_search'],
          evidenceReference: 'SYNTHETIC-EVIDENCE',
          decidedBy: staff.rights,
        });
      }
      return { jurisdictionId, sourceId };
    });
    return created;
  }

  const court = (w: World, name = unique('SYNTHETIC court')) =>
    asDataops((tx) =>
      corpusStore.createCourt(tx, {
        jurisdictionId: w.jurisdictionId,
        name,
        level: 1,
        authorityRank: 1,
      }),
    );

  /** A version with two passages, created by the ingest role and left in `ingesting`. */
  async function draft(
    w: World,
    options: { type?: DocumentType; title?: string } = {},
  ): Promise<Drafted> {
    return asIngest(async (tx) => {
      const documentId = await corpusStore.createDocument(tx, {
        jurisdictionId: w.jurisdictionId,
        documentType: options.type ?? 'case',
        title: options.title ?? '[SYNTHETIC] A v B',
      });
      const versionId = await corpusStore.createVersion(tx, {
        documentId,
        jurisdictionId: w.jurisdictionId,
        versionNumber: 1,
        sourceId: w.sourceId,
        acquiredAt: new Date(),
        contentChecksum: sha256(unique('bytes')),
        storageKey: `synthetic/${unique('k')}`,
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

  /** A case awaiting review, with the case details a person recorded from the source. */
  async function pendingCase(w: World, details: CaseDetails | 'none' = {}): Promise<Drafted> {
    const drafted = await draft(w, { type: 'case' });
    if (details !== 'none') {
      const courtId = details.courtId ?? (await court(w));
      await asDataops((tx) =>
        corpusStore.addCaseDetails(tx, {
          documentId: drafted.documentId,
          jurisdictionId: w.jurisdictionId,
          courtId,
          decisionDate: details.decisionDate ?? '2000-01-01',
          ...(details.neutralCitation === undefined
            ? {}
            : { neutralCitation: details.neutralCitation }),
          ...(details.docketNumber === undefined ? {} : { docketNumber: details.docketNumber }),
        }),
      );
    }
    await submit(drafted.versionId);
    return drafted;
  }

  async function pendingLegislation(w: World, instrumentNumber?: string): Promise<Drafted> {
    const drafted = await draft(w, { type: 'legislation', title: '[SYNTHETIC] Widgets Act' });
    if (instrumentNumber !== undefined) {
      await asDataops((tx) =>
        tx.query(
          'INSERT INTO corpus.legislation_details (document_id, instrument_number) VALUES ($1, $2)',
          [drafted.documentId, instrumentNumber],
        ),
      );
    }
    await submit(drafted.versionId);
    return drafted;
  }

  const metadataOf = (versionId: VersionId) =>
    asDataops((tx) => corpusStore.criticalMetadata(tx, versionId));

  /** Records a human verification of what the corpus currently holds for `field`. */
  async function verify(
    versionId: VersionId,
    field: MetadataField,
    options: {
      status?: VerificationStatus;
      evidence?: string;
      by?: string;
      fingerprint?: Buffer;
    } = {},
  ) {
    const row = (await metadataOf(versionId)).find((r) => r.field === field);
    return asDataops((tx) =>
      corpusStore.recordFieldVerification(tx, {
        versionId,
        field,
        status: options.status ?? 'verified',
        valueSha256: options.fingerprint ?? fieldFingerprint(field, row?.value ?? ''),
        evidenceReference: options.evidence ?? 'SYNTHETIC page 1 of the source document',
        verifiedBy: options.by ?? staff.verifier,
      }),
    );
  }

  /** Verifies every field the corpus holds a value for, as a careful reviewer would. */
  async function verifyAll(versionId: VersionId): Promise<void> {
    for (const row of await metadataOf(versionId)) {
      if (row.value !== null) await verify(versionId, row.field);
    }
  }

  /**
   * Records an attestation for the version, as the ingestion pipeline's checked function would
   * (see ingestion migration 0002). No runtime role may write one, so a corpus-only test stands
   * in for that function through the owner path. Idempotent.
   */
  const attest = (versionId: VersionId) =>
    admin((c) =>
      c.query(
        `INSERT INTO corpus.version_provenance_attestations
           (version_id, source_id, content_checksum, pipeline_version, attestation_type,
            attestation_version, evidence_reference, system_identity)
         SELECT id, source_id, content_checksum, pipeline_version, 'ingestion_pipeline', 1,
                'SYNTHETIC: test attestation', 'synthetic-test'
           FROM corpus.document_versions WHERE id = $1
         ON CONFLICT (version_id, attestation_type, attestation_version) DO NOTHING`,
        [versionId],
      ),
    );

  /** Approves; attests first unless told not to, so a test can meet the provenance gate itself. */
  const approve = async (
    versionId: VersionId,
    by = staff.reviewer,
    options: { attest?: boolean } = {},
  ) => {
    if (options.attest !== false) await attest(versionId);
    return asDataops((tx) => corpusStore.approveVersion(tx, versionId, by));
  };
  const publish = (versionId: VersionId, by = staff.publisher) =>
    asDataops((tx) => corpusStore.publishVersion(tx, versionId, by));

  const stateOf = async (versionId: VersionId) =>
    (
      await admin((c) =>
        c.query<{ lifecycle_state: string }>(
          'SELECT lifecycle_state FROM corpus.document_versions WHERE id = $1',
          [versionId],
        ),
      )
    ).rows[0]?.lifecycle_state;

  const count = async (sql: string, params: unknown[] = []) =>
    Number((await admin((c) => c.query<{ n: string }>(sql, params))).rows[0]?.n ?? 0);

  return {
    database,
    ingest,
    dataops,
    app,
    admin,
    asIngest,
    asDataops,
    asApp,
    staff,
    unique,
    world,
    court,
    draft,
    submit,
    pendingCase,
    pendingLegislation,
    metadataOf,
    verify,
    verifyAll,
    attest,
    approve,
    publish,
    stateOf,
    count,
    dispose: () => database.dispose(),
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
