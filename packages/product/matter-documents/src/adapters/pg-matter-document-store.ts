import type { Tx } from '@legalintel/db';

import {
  MatterDocumentId,
  type MatterDocument,
  type MatterDocumentStatus,
} from '../domain/document';
import { MatterDocumentVersionId, type MatterDocumentVersion } from '../domain/document-version';
import type {
  CreateMatterDocumentInput,
  CreateMatterDocumentVersionInput,
  MatterDocumentStore,
  UpdateMatterDocumentInput,
} from '../ports/matter-document-store';

interface DocumentRow {
  id: string;
  organization_id: string;
  matter_id: string;
  name: string;
  description: string | null;
  status: MatterDocumentStatus;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  organization_id: string;
  matter_id: string;
  document_id: string;
  version_number: number;
  original_filename: string;
  mime_type: string;
  storage_key: string;
  content_sha256: string;
  size_bytes: string | number;
  created_at: Date;
}

function mapDocument(row: DocumentRow): MatterDocument {
  return {
    id: MatterDocumentId.parse(row.id),
    organizationId: row.organization_id,
    matterId: row.matter_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): MatterDocumentVersion {
  return {
    id: MatterDocumentVersionId.parse(row.id),
    organizationId: row.organization_id,
    matterId: row.matter_id,
    documentId: MatterDocumentId.parse(row.document_id),
    versionNumber: row.version_number,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    contentSha256: row.content_sha256,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  };
}

export class PgMatterDocumentStore implements MatterDocumentStore<Tx> {
  async createDocument(tx: Tx, input: CreateMatterDocumentInput): Promise<MatterDocument> {
    const result = await tx.query<DocumentRow>(
      `INSERT INTO matter_documents.documents (
         organization_id,
         id,
         matter_id,
         name,
         description
       )
       VALUES (
         app.current_org_id(),
         $1,
         $2,
         $3,
         $4
       )
       RETURNING
         id,
         organization_id,
         matter_id,
         name,
         description,
         status,
         created_at,
         updated_at`,
      [input.id, input.matterId, input.name, input.description ?? null],
    );

    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('matter_documents.persistence_missing_document_row');
    }

    return mapDocument(row);
  }

  async findDocument(tx: Tx, id: MatterDocumentId): Promise<MatterDocument | null> {
    const result = await tx.query<DocumentRow>(
      `SELECT
         id,
         organization_id,
         matter_id,
         name,
         description,
         status,
         created_at,
         updated_at
       FROM matter_documents.documents
       WHERE organization_id = app.current_org_id()
         AND id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapDocument(row);
  }

  async listDocuments(
    tx: Tx,
    matterId: string,
    status?: MatterDocumentStatus,
  ): Promise<readonly MatterDocument[]> {
    const params: unknown[] = [matterId];

    let statusClause = '';

    if (status !== undefined) {
      params.push(status);
      statusClause = ` AND status = $2`;
    }

    const result = await tx.query<DocumentRow>(
      `SELECT
         id,
         organization_id,
         matter_id,
         name,
         description,
         status,
         created_at,
         updated_at
       FROM matter_documents.documents
       WHERE organization_id = app.current_org_id()
         AND matter_id = $1
         ${statusClause}
       ORDER BY created_at DESC, id DESC`,
      params,
    );

    return result.rows.map(mapDocument);
  }

  async updateDocument(tx: Tx, input: UpdateMatterDocumentInput): Promise<MatterDocument | null> {
    const result = await tx.query<DocumentRow>(
      `UPDATE matter_documents.documents
       SET
         name = $2,
         description = CASE
           WHEN $3::boolean THEN $4::text
           ELSE description
         END,
         updated_at = clock_timestamp()
       WHERE organization_id = app.current_org_id()
         AND id = $1
       RETURNING
         id,
         organization_id,
         matter_id,
         name,
         description,
         status,
         created_at,
         updated_at`,
      [input.id, input.name, input.description !== undefined, input.description ?? null],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapDocument(row);
  }

  async setDocumentStatus(
    tx: Tx,
    id: MatterDocumentId,
    status: MatterDocumentStatus,
  ): Promise<MatterDocument | null> {
    const result = await tx.query<DocumentRow>(
      `UPDATE matter_documents.documents
       SET
         status = $2,
         updated_at = clock_timestamp()
       WHERE organization_id = app.current_org_id()
         AND id = $1
       RETURNING
         id,
         organization_id,
         matter_id,
         name,
         description,
         status,
         created_at,
         updated_at`,
      [id, status],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapDocument(row);
  }

  async createDocumentVersion(
    tx: Tx,
    input: CreateMatterDocumentVersionInput,
  ): Promise<MatterDocumentVersion> {
    /*
     * Serialize version allocation on the document row.
     *
     * The row lock is tenant-scoped by RLS and document id, so concurrent
     * uploads for one document serialize without locking unrelated documents.
     */
    const locked = await tx.query<{ id: string; matter_id: string }>(
      `SELECT id, matter_id
       FROM matter_documents.documents
       WHERE organization_id = app.current_org_id()
         AND id = $1
         AND matter_id = $2
       FOR UPDATE`,
      [input.documentId, input.matterId],
    );

    if (locked.rows[0] === undefined) {
      throw new Error('matter_documents.document_not_found');
    }

    const result = await tx.query<VersionRow>(
      `INSERT INTO matter_documents.document_versions (
         organization_id,
         id,
         matter_id,
         document_id,
         version_number,
         original_filename,
         mime_type,
         storage_key,
         content_sha256,
         size_bytes
       )
       SELECT
         app.current_org_id(),
         $1,
         $2,
         $3,
         COALESCE(MAX(version_number), 0) + 1,
         $4,
         $5,
         $6,
         $7,
         $8
       FROM matter_documents.document_versions
       WHERE organization_id = app.current_org_id()
         AND document_id = $3
       RETURNING
         id,
         organization_id,
         matter_id,
         document_id,
         version_number,
         original_filename,
         mime_type,
         storage_key,
         content_sha256,
         size_bytes,
         created_at`,
      [
        input.id,
        input.matterId,
        input.documentId,
        input.originalFilename,
        input.mimeType,
        input.storageKey,
        input.contentSha256,
        input.sizeBytes,
      ],
    );

    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('matter_documents.persistence_missing_document_version_row');
    }

    return mapVersion(row);
  }

  async listDocumentVersions(
    tx: Tx,
    documentId: MatterDocumentId,
  ): Promise<readonly MatterDocumentVersion[]> {
    const result = await tx.query<VersionRow>(
      `SELECT
         id,
         organization_id,
         matter_id,
         document_id,
         version_number,
         original_filename,
         mime_type,
         storage_key,
         content_sha256,
         size_bytes,
         created_at
       FROM matter_documents.document_versions
       WHERE organization_id = app.current_org_id()
         AND document_id = $1
       ORDER BY version_number DESC`,
      [documentId],
    );

    return result.rows.map(mapVersion);
  }
}
