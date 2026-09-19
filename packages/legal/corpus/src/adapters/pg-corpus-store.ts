import { createHash } from 'node:crypto';

import type { Tx } from '@legalintel/db';
import {
  conflict,
  forbidden,
  internalError,
  notFound,
  preconditionFailed,
  validationError,
} from '@legalintel/kernel';

import type { DocumentType, SourceKind } from '../domain/authority';
import {
  CourtId,
  DocumentId,
  JurisdictionId,
  PassageId,
  SourceId,
  VersionId,
  CitationId,
} from '../domain/ids';
import type { LifecycleState } from '../domain/lifecycle';
import type { RelationshipType, ReviewStatus } from '../domain/relationships';
import type { RightsStatus, RightsUse } from '../domain/rights';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  hint?: unknown;
}

/**
 * Database errors become typed errors with fixed messages. Driver text can quote table names
 * and values, so it never reaches a caller; the stable `code` is what clients act on.
 */
export function mapCorpusError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return error;
  const { code, constraint, hint } = error as PgErrorLike;
  const h = typeof hint === 'string' ? hint : '';
  const c = typeof constraint === 'string' ? constraint : '';

  switch (h) {
    case 'corpus.rights_not_cleared':
      return preconditionFailed(
        'corpus.rights_not_cleared',
        'The source has no current rights decision that allows this content to be shown and searched.',
      );
    case 'corpus.invalid_transition':
      return preconditionFailed(
        'corpus.invalid_transition',
        'That lifecycle change is not allowed.',
      );
    case 'corpus.version_immutable':
      return preconditionFailed(
        'corpus.version_immutable',
        'A version cannot be changed. Publish a new version instead.',
      );
    case 'corpus.passages_frozen':
      return preconditionFailed(
        'corpus.passages_frozen',
        'Passages cannot change once a version has left ingestion.',
      );
    case 'corpus.invalid_creation':
      return validationError(
        'corpus.invalid_creation',
        'A version must be created in the ingesting state.',
      );
    case 'corpus.append_only':
      return forbidden('corpus.append_only', 'This record cannot be changed or removed.');
    default:
  }

  switch (code) {
    case '23505':
      if (c === 'document_versions_document_id_content_checksum_key') {
        return conflict(
          'corpus.duplicate_content',
          'This exact content is already a version of the document.',
        );
      }
      if (c === 'document_versions_document_id_version_number_key') {
        return conflict('corpus.version_number_taken', 'That version number already exists.');
      }
      return conflict('corpus.conflict', 'The record already exists.');
    case '23514':
      if (c === 'two_person_rule') {
        return forbidden(
          'corpus.two_person_rule',
          'The person who approved a version cannot also publish it.',
        );
      }
      if (c === 'passage_hash_matches') {
        return validationError(
          'corpus.passage_hash_mismatch',
          'The passage hash does not match its text.',
        );
      }
      return validationError('input.invalid', 'One or more values are not valid.');
    case '23503':
      return notFound(
        'corpus.reference_not_found',
        'A referenced record does not exist, or belongs to another jurisdiction.',
      );
    case '42501':
      return forbidden('authz.denied', 'You do not have permission to perform this action.');
    default:
      return error;
  }
}

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapCorpusError(error);
  }
}

const idOf = async (tx: Tx, sql: string, values: readonly unknown[]): Promise<string> => {
  const result = await tx.query<{ id: string }>(sql, values);
  const id = result.rows[0]?.id;
  if (id === undefined) throw internalError('corpus.no_row', 'An insert returned no row.');
  return id;
};

export interface NewVersion {
  readonly documentId: DocumentId;
  readonly jurisdictionId: JurisdictionId;
  readonly versionNumber: number;
  readonly sourceId: SourceId;
  readonly sourceReference?: string;
  readonly acquiredAt: Date;
  /** SHA-256 of the acquired file. */
  readonly contentChecksum: Buffer;
  readonly storageKey: string;
  readonly pipelineVersion: string;
  readonly language?: string;
  readonly supersedesVersionId?: VersionId;
}

export interface NewPassage {
  readonly ordinal: number;
  readonly locator: string;
  readonly text: string;
  readonly extractionConfidence?: number;
}

export interface UserVersion {
  readonly id: VersionId;
  readonly documentId: DocumentId;
  readonly jurisdictionId: JurisdictionId;
  readonly versionNumber: number;
  readonly sourceId: SourceId;
  readonly acquiredAt: Date;
  readonly contentChecksum: Buffer;
  readonly lifecycleState: LifecycleState;
  readonly publishedAt: Date | null;
}

export interface UserPassage {
  readonly id: PassageId;
  readonly versionId: VersionId;
  readonly ordinal: number;
  readonly locator: string;
  readonly text: string;
}

export interface CitationRecord {
  readonly id: CitationId;
  readonly fromVersionId: VersionId;
  readonly toDocumentId: DocumentId;
  readonly relationshipType: RelationshipType;
  readonly citationText: string;
  readonly evidencePassageId: PassageId;
  readonly reviewStatus: ReviewStatus;
}

export const sha256 = (input: string | Buffer): Buffer =>
  createHash('sha256').update(input).digest();

/**
 * Each method states the database role expected to call it. Calling as the wrong role is
 * refused by the database, not by this code.
 */
export const corpusStore = {
  // ---- dataops: reference data and rights ------------------------------------------------
  async createJurisdiction(
    tx: Tx,
    input: {
      code: string;
      name: string;
      kind: 'country' | 'supranational' | 'region';
      parentId?: JurisdictionId;
      isSynthetic?: boolean;
    },
  ): Promise<JurisdictionId> {
    return guard(async () =>
      JurisdictionId.parse(
        await idOf(
          tx,
          `INSERT INTO corpus.jurisdictions (code, name, kind, parent_id, is_synthetic)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [input.code, input.name, input.kind, input.parentId ?? null, input.isSynthetic ?? false],
        ),
      ),
    );
  },

  async createCourt(
    tx: Tx,
    input: {
      jurisdictionId: JurisdictionId;
      name: string;
      level: number;
      authorityRank: number;
      appealToCourtId?: CourtId;
    },
  ): Promise<CourtId> {
    return guard(async () =>
      CourtId.parse(
        await idOf(
          tx,
          `INSERT INTO corpus.courts (jurisdiction_id, name, level, authority_rank, appeal_to_court_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            input.jurisdictionId,
            input.name,
            input.level,
            input.authorityRank,
            input.appealToCourtId ?? null,
          ],
        ),
      ),
    );
  },

  async registerSource(
    tx: Tx,
    input: { jurisdictionId: JurisdictionId; name: string; kind: SourceKind; reference?: string },
  ): Promise<SourceId> {
    return guard(async () =>
      SourceId.parse(
        await idOf(
          tx,
          `INSERT INTO corpus.sources (jurisdiction_id, name, kind, reference)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.jurisdictionId, input.name, input.kind, input.reference ?? null],
        ),
      ),
    );
  },

  /** Appends to the rights ledger. Decisions are never edited: a later decision supersedes. */
  async recordRightsDecision(
    tx: Tx,
    input: {
      sourceId: SourceId;
      status: RightsStatus;
      allowedUses: readonly RightsUse[];
      evidenceReference?: string;
      restrictions?: string;
      decidedBy: string;
      effectiveFrom?: Date;
      expiresAt?: Date;
    },
  ): Promise<string> {
    return guard(() =>
      idOf(
        tx,
        `INSERT INTO corpus.source_rights_decisions
           (source_id, status, allowed_uses, evidence_reference, restrictions, decided_by, effective_from, expires_at)
         VALUES ($1, $2, $3::text[], $4, $5, $6, coalesce($7, now()), $8) RETURNING id`,
        [
          input.sourceId,
          input.status,
          [...input.allowedUses],
          input.evidenceReference ?? null,
          input.restrictions ?? null,
          input.decidedBy,
          input.effectiveFrom ?? null,
          input.expiresAt ?? null,
        ],
      ),
    );
  },

  // ---- ingest: drafts --------------------------------------------------------------------
  async createDocument(
    tx: Tx,
    input: { jurisdictionId: JurisdictionId; documentType: DocumentType; title: string },
  ): Promise<DocumentId> {
    return guard(async () =>
      DocumentId.parse(
        await idOf(
          tx,
          `INSERT INTO corpus.legal_documents (jurisdiction_id, document_type, title)
           VALUES ($1, $2, $3) RETURNING id`,
          [input.jurisdictionId, input.documentType, input.title],
        ),
      ),
    );
  },

  async addCaseDetails(
    tx: Tx,
    input: {
      documentId: DocumentId;
      jurisdictionId: JurisdictionId;
      courtId: CourtId;
      decisionDate?: string;
      neutralCitation?: string;
      docketNumber?: string;
    },
  ): Promise<void> {
    await guard(() =>
      tx.query(
        `INSERT INTO corpus.case_details
           (document_id, jurisdiction_id, court_id, decision_date, neutral_citation, docket_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.documentId,
          input.jurisdictionId,
          input.courtId,
          input.decisionDate ?? null,
          input.neutralCitation ?? null,
          input.docketNumber ?? null,
        ],
      ),
    );
  },

  async createVersion(tx: Tx, input: NewVersion): Promise<VersionId> {
    return guard(async () =>
      VersionId.parse(
        await idOf(
          tx,
          `INSERT INTO corpus.document_versions
             (document_id, jurisdiction_id, version_number, source_id, source_reference, acquired_at,
              content_checksum, storage_key, pipeline_version, language, supersedes_version_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, 'en'), $11) RETURNING id`,
          [
            input.documentId,
            input.jurisdictionId,
            input.versionNumber,
            input.sourceId,
            input.sourceReference ?? null,
            input.acquiredAt,
            input.contentChecksum,
            input.storageKey,
            input.pipelineVersion,
            input.language ?? null,
            input.supersedesVersionId ?? null,
          ],
        ),
      ),
    );
  },

  async addPassages(tx: Tx, versionId: VersionId, passages: readonly NewPassage[]): Promise<void> {
    for (const passage of passages) {
      await guard(() =>
        tx.query(
          `INSERT INTO corpus.passages (version_id, ordinal, locator, text, text_sha256, extraction_confidence)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            versionId,
            passage.ordinal,
            passage.locator,
            passage.text,
            sha256(passage.text),
            passage.extractionConfidence ?? null,
          ],
        ),
      );
    }
  },

  async submitForReview(tx: Tx, versionId: VersionId): Promise<void> {
    await this.moveVersion(tx, versionId, 'pending_review');
  },

  async rejectVersion(tx: Tx, versionId: VersionId): Promise<void> {
    await this.moveVersion(tx, versionId, 'rejected');
  },

  async moveVersion(tx: Tx, versionId: VersionId, state: LifecycleState): Promise<void> {
    const result = await guard(() =>
      tx.query('UPDATE corpus.document_versions SET lifecycle_state = $2 WHERE id = $1', [
        versionId,
        state,
      ]),
    );
    if (result.rowCount === 0) {
      // Either no such version, or the caller's role may not touch it in its current state.
      throw notFound('corpus.version_not_found', 'No such version in a state you may change.');
    }
  },

  // ---- dataops: review and publication ---------------------------------------------------
  async approveVersion(tx: Tx, versionId: VersionId, approvedBy: string): Promise<void> {
    const result = await guard(() =>
      tx.query(
        `UPDATE corpus.document_versions SET lifecycle_state = 'approved', approved_by = $2 WHERE id = $1`,
        [versionId, approvedBy],
      ),
    );
    if (result.rowCount === 0)
      throw notFound('corpus.version_not_found', 'No such version in a state you may change.');
  },

  async publishVersion(tx: Tx, versionId: VersionId, publishedBy: string): Promise<void> {
    const result = await guard(() =>
      tx.query(
        `UPDATE corpus.document_versions SET lifecycle_state = 'published', published_by = $2 WHERE id = $1`,
        [versionId, publishedBy],
      ),
    );
    if (result.rowCount === 0)
      throw notFound('corpus.version_not_found', 'No such version in a state you may change.');
  },

  async withdrawVersion(tx: Tx, versionId: VersionId, reason: string): Promise<void> {
    const result = await guard(() =>
      tx.query(
        `UPDATE corpus.document_versions SET lifecycle_state = 'withdrawn', withdrawal_reason = $2 WHERE id = $1`,
        [versionId, reason],
      ),
    );
    if (result.rowCount === 0)
      throw notFound('corpus.version_not_found', 'No such version in a state you may change.');
  },

  // ---- reads (the application role sees only published, rights-cleared content) ----------
  async getVersion(tx: Tx, versionId: VersionId): Promise<UserVersion | null> {
    return guard(async () => {
      const result = await tx.query<{
        id: string;
        document_id: string;
        jurisdiction_id: string;
        version_number: number;
        source_id: string;
        acquired_at: Date;
        content_checksum: Buffer;
        lifecycle_state: LifecycleState;
        published_at: Date | null;
      }>(
        // Explicit columns: the application role is not granted the internal ones.
        `SELECT id, document_id, jurisdiction_id, version_number, source_id, acquired_at,
                content_checksum, lifecycle_state, published_at
           FROM corpus.document_versions WHERE id = $1`,
        [versionId],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : {
            id: VersionId.parse(row.id),
            documentId: DocumentId.parse(row.document_id),
            jurisdictionId: JurisdictionId.parse(row.jurisdiction_id),
            versionNumber: row.version_number,
            sourceId: SourceId.parse(row.source_id),
            acquiredAt: row.acquired_at,
            contentChecksum: row.content_checksum,
            lifecycleState: row.lifecycle_state,
            publishedAt: row.published_at,
          };
    });
  },

  async listPassages(tx: Tx, versionId: VersionId): Promise<UserPassage[]> {
    return guard(async () => {
      const result = await tx.query<{
        id: string;
        version_id: string;
        ordinal: number;
        locator: string;
        text: string;
      }>(
        'SELECT id, version_id, ordinal, locator, text FROM corpus.passages WHERE version_id = $1 ORDER BY ordinal',
        [versionId],
      );
      return result.rows.map((row) => ({
        id: PassageId.parse(row.id),
        versionId: VersionId.parse(row.version_id),
        ordinal: row.ordinal,
        locator: row.locator,
        text: row.text,
      }));
    });
  },

  // ---- citation graph ---------------------------------------------------------------------
  async addCitation(
    tx: Tx,
    input: {
      fromVersionId: VersionId;
      toDocumentId: DocumentId;
      relationshipType: RelationshipType;
      citationText: string;
      evidencePassageId: PassageId;
      origin: 'machine' | 'human';
      confidence?: number;
      reviewStatus?: ReviewStatus;
      reviewedBy?: string;
    },
  ): Promise<CitationId> {
    return guard(async () =>
      CitationId.parse(
        await idOf(
          tx,
          `INSERT INTO graph.citations
             (from_version_id, to_document_id, relationship_type, citation_text, evidence_passage_id,
              origin, confidence, review_status, reviewed_by, reviewed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 'unreviewed'), $9,
                   CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END) RETURNING id`,
          [
            input.fromVersionId,
            input.toDocumentId,
            input.relationshipType,
            input.citationText,
            input.evidencePassageId,
            input.origin,
            input.confidence ?? null,
            input.reviewStatus ?? null,
            input.reviewedBy ?? null,
          ],
        ),
      ),
    );
  },

  async reviewCitation(
    tx: Tx,
    citationId: CitationId,
    status: 'human_reviewed' | 'rejected',
    reviewedBy: string,
  ): Promise<void> {
    const result = await guard(() =>
      tx.query(
        `UPDATE graph.citations SET review_status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
        [citationId, status, reviewedBy],
      ),
    );
    if (result.rowCount === 0) throw notFound('corpus.citation_not_found', 'Citation not found.');
  },

  async listCitationsFrom(tx: Tx, versionId: VersionId): Promise<CitationRecord[]> {
    return guard(async () => {
      const result = await tx.query<{
        id: string;
        from_version_id: string;
        to_document_id: string;
        relationship_type: RelationshipType;
        citation_text: string;
        evidence_passage_id: string;
        review_status: ReviewStatus;
      }>(
        `SELECT id, from_version_id, to_document_id, relationship_type, citation_text,
                evidence_passage_id, review_status
           FROM graph.citations WHERE from_version_id = $1 ORDER BY created_at, id`,
        [versionId],
      );
      return result.rows.map((row) => ({
        id: CitationId.parse(row.id),
        fromVersionId: VersionId.parse(row.from_version_id),
        toDocumentId: DocumentId.parse(row.to_document_id),
        relationshipType: row.relationship_type,
        citationText: row.citation_text,
        evidencePassageId: PassageId.parse(row.evidence_passage_id),
        reviewStatus: row.review_status,
      }));
    });
  },

  async countSyntheticJurisdictions(tx: Tx): Promise<number> {
    const result = await tx.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM corpus.jurisdictions WHERE is_synthetic',
    );
    return Number(result.rows[0]?.n ?? '0');
  },
};
