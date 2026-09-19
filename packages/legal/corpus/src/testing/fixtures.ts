import { withPublicTransaction, type DbPool } from '@legalintel/db';

import { corpusStore, sha256 } from '../adapters/pg-corpus-store';
import type {
  CourtId,
  DocumentId,
  JurisdictionId,
  PassageId,
  SourceId,
  VersionId,
} from '../domain/ids';

/**
 * A small, obviously fake corpus for tests. Everything is labelled SYNTHETIC in its name and
 * text, lives under a jurisdiction flagged `is_synthetic`, and contains no statement of real
 * law. Production services refuse to start if it exists (see assertNoSyntheticInProduction).
 */
export interface SyntheticCorpus {
  readonly jurisdictionId: JurisdictionId;
  readonly courts: { readonly supreme: CourtId; readonly appeal: CourtId; readonly high: CourtId };
  readonly sourceId: SourceId;
  readonly documents: readonly {
    readonly documentId: DocumentId;
    readonly versionId: VersionId;
    readonly passageIds: readonly PassageId[];
  }[];
}

export interface StaffIds {
  /** Records rights decisions. */
  readonly rightsOfficer: string;
  /** Approves versions. */
  readonly reviewer: string;
  /** Publishes versions. Must differ from the reviewer (two-person rule). */
  readonly publisher: string;
}

export interface SeedPools {
  readonly ingest: DbPool;
  readonly dataops: DbPool;
}

export const SYNTHETIC_TEXT = [
  'SYNTHETIC TEST TEXT. This passage is fabricated for software tests and is not a statement of law.',
  'SYNTHETIC TEST TEXT. The fictional Test Act 1 provides that a fictional widget must be registered.',
  'SYNTHETIC TEST TEXT. In the fictional case of Alpha v Beta the fictional court held for the fictional appellant.',
];

/** Seeds a jurisdiction, three courts, an approved source and `documentCount` published cases. */
export async function seedSyntheticCorpus(
  pools: SeedPools,
  staff: StaffIds,
  options: { documentCount?: number; suffix?: string } = {},
): Promise<SyntheticCorpus> {
  const suffix = options.suffix ?? Math.random().toString(36).slice(2, 8);
  const count = options.documentCount ?? 2;

  const reference = await withPublicTransaction(pools.dataops, async (tx) => {
    const jurisdictionId = await corpusStore.createJurisdiction(tx, {
      code: `ZZ-${suffix.toUpperCase().slice(0, 6)}`,
      name: `SYNTHETIC Test Jurisdiction ${suffix} (NOT REAL LAW)`,
      kind: 'country',
      isSynthetic: true,
    });
    const supreme = await corpusStore.createCourt(tx, {
      jurisdictionId,
      name: 'SYNTHETIC Supreme Court',
      level: 1,
      authorityRank: 1,
    });
    const appeal = await corpusStore.createCourt(tx, {
      jurisdictionId,
      name: 'SYNTHETIC Court of Appeal',
      level: 2,
      authorityRank: 2,
      appealToCourtId: supreme,
    });
    const high = await corpusStore.createCourt(tx, {
      jurisdictionId,
      name: 'SYNTHETIC High Court',
      level: 3,
      authorityRank: 3,
      appealToCourtId: appeal,
    });
    const sourceId = await corpusStore.registerSource(tx, {
      jurisdictionId,
      name: `SYNTHETIC Source ${suffix}`,
      kind: 'institutional_repository',
      reference: 'synthetic://none',
    });
    await corpusStore.recordRightsDecision(tx, {
      sourceId,
      status: 'approved',
      allowedUses: ['display', 'index_search', 'ai_processing'],
      evidenceReference: 'SYNTHETIC-RIGHTS-EVIDENCE',
      decidedBy: staff.rightsOfficer,
    });
    return { jurisdictionId, courts: { supreme, appeal, high }, sourceId };
  });

  const documents: SyntheticCorpus['documents'][number][] = [];
  for (let index = 0; index < count; index += 1) {
    const draft = await withPublicTransaction(pools.ingest, async (tx) => {
      const documentId = await corpusStore.createDocument(tx, {
        jurisdictionId: reference.jurisdictionId,
        documentType: 'case',
        title: `[SYNTHETIC] Alpha ${index} v Beta ${index}`,
      });
      await corpusStore.addCaseDetails(tx, {
        documentId,
        jurisdictionId: reference.jurisdictionId,
        courtId: reference.courts.high,
        decisionDate: '2000-01-01',
        neutralCitation: `[SYNTHETIC ${suffix}-${index}]`,
      });
      const versionId = await corpusStore.createVersion(tx, {
        documentId,
        jurisdictionId: reference.jurisdictionId,
        versionNumber: 1,
        sourceId: reference.sourceId,
        acquiredAt: new Date(),
        contentChecksum: sha256(`synthetic-${suffix}-${index}`),
        storageKey: `synthetic/${suffix}/${index}.txt`,
        pipelineVersion: 'synthetic-1',
      });
      await corpusStore.addPassages(
        tx,
        versionId,
        SYNTHETIC_TEXT.map((text, ordinal) => ({
          ordinal,
          locator: `¶${ordinal + 1}`,
          text: `${text} (${index})`,
          extractionConfidence: 1,
        })),
      );
      await corpusStore.submitForReview(tx, versionId);
      const passages = await tx.query<{ id: string }>(
        'SELECT id FROM corpus.passages WHERE version_id = $1 ORDER BY ordinal',
        [versionId],
      );
      return { documentId, versionId, passageIds: passages.rows.map((row) => row.id) };
    });

    await withPublicTransaction(pools.dataops, async (tx) => {
      await corpusStore.approveVersion(tx, draft.versionId, staff.reviewer);
      await corpusStore.publishVersion(tx, draft.versionId, staff.publisher);
    });
    documents.push({ ...draft, passageIds: draft.passageIds as PassageId[] });
  }

  return { ...reference, documents };
}
