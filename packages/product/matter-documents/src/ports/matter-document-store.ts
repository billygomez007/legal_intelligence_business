import type { MatterDocument, MatterDocumentId, MatterDocumentStatus } from '../domain/document';
import type { MatterDocumentVersion, MatterDocumentVersionId } from '../domain/document-version';

export interface CreateMatterDocumentInput {
  readonly id: MatterDocumentId;
  readonly matterId: string;
  readonly name: string;
  readonly description?: string | null;
}

export interface UpdateMatterDocumentInput {
  readonly id: MatterDocumentId;
  readonly name: string;
  readonly description?: string | null;
}

export interface CreateMatterDocumentVersionInput {
  readonly id: MatterDocumentVersionId;
  readonly matterId: string;
  readonly documentId: MatterDocumentId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
}

export interface MatterDocumentStore<TTransaction> {
  createDocument(tx: TTransaction, input: CreateMatterDocumentInput): Promise<MatterDocument>;

  findDocument(tx: TTransaction, id: MatterDocumentId): Promise<MatterDocument | null>;

  listDocuments(
    tx: TTransaction,
    matterId: string,
    status?: MatterDocumentStatus,
  ): Promise<readonly MatterDocument[]>;

  updateDocument(
    tx: TTransaction,
    input: UpdateMatterDocumentInput,
  ): Promise<MatterDocument | null>;

  setDocumentStatus(
    tx: TTransaction,
    id: MatterDocumentId,
    status: MatterDocumentStatus,
  ): Promise<MatterDocument | null>;

  createDocumentVersion(
    tx: TTransaction,
    input: CreateMatterDocumentVersionInput,
  ): Promise<MatterDocumentVersion>;

  listDocumentVersions(
    tx: TTransaction,
    documentId: MatterDocumentId,
  ): Promise<readonly MatterDocumentVersion[]>;
}
