import type {
  KnowledgeSource,
  KnowledgeSourceId,
  KnowledgeSourceStatus,
} from '../domain/source.js';
import type { KnowledgeSourceVersion, KnowledgeSourceVersionId } from '../domain/source-version.js';

export interface CreateKnowledgeSourceInput {
  readonly id: KnowledgeSourceId;
  readonly name: string;
  readonly description?: string | null;
}

export interface UpdateKnowledgeSourceInput {
  readonly id: KnowledgeSourceId;
  readonly name: string;
  readonly description?: string | null;
}

export interface CreateKnowledgeSourceVersionInput {
  readonly id: KnowledgeSourceVersionId;
  readonly sourceId: KnowledgeSourceId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
}

export interface KnowledgeStore<TTransaction> {
  createSource(tx: TTransaction, input: CreateKnowledgeSourceInput): Promise<KnowledgeSource>;

  findSource(tx: TTransaction, id: KnowledgeSourceId): Promise<KnowledgeSource | null>;

  listSources(
    tx: TTransaction,
    status?: KnowledgeSourceStatus,
  ): Promise<readonly KnowledgeSource[]>;

  updateSource(
    tx: TTransaction,
    input: UpdateKnowledgeSourceInput,
  ): Promise<KnowledgeSource | null>;

  setSourceStatus(
    tx: TTransaction,
    id: KnowledgeSourceId,
    status: KnowledgeSourceStatus,
  ): Promise<KnowledgeSource | null>;

  createSourceVersion(
    tx: TTransaction,
    input: CreateKnowledgeSourceVersionInput,
  ): Promise<KnowledgeSourceVersion>;

  listSourceVersions(
    tx: TTransaction,
    sourceId: KnowledgeSourceId,
  ): Promise<readonly KnowledgeSourceVersion[]>;
}
