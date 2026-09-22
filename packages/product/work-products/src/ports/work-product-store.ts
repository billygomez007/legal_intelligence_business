import type { WorkProductSourceReference } from './revision-source-reader.js';

export interface StoredWorkProduct {
  readonly organizationId: string;
  readonly id: string;
  readonly aiTaskId: string;
  readonly matterId: string | null;
  readonly title: string;
  readonly kind: string;
  readonly status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'archived';
  readonly currentRevisionId: string | null;
  readonly submittedRevisionId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export interface StoredWorkProductRevision {
  readonly organizationId: string;
  readonly id: string;
  readonly workProductId: string;
  readonly revisionNumber: number;
  readonly taskScopeRevision: number;
  readonly previousRevisionId: string | null;
  readonly content: string;
  readonly contentFormat: 'plain_text' | 'markdown';
  readonly contentSha256: string;
  readonly revisionSha256: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface StoredWorkProductReview {
  readonly organizationId: string;
  readonly id: string;
  readonly workProductId: string;
  readonly revisionId: string;
  readonly decision: 'approved' | 'rejected';
  readonly reason: string | null;
  readonly decidedBy: string;
  readonly decidedAt: Date;
}

export interface CreateWorkProductStoreInput {
  readonly id: string;
  readonly aiTaskId: string;
  readonly matterId: string | null;
  readonly title: string;
  readonly kind: string;
  readonly createdBy: string;
}

export interface AppendWorkProductRevisionStoreInput {
  readonly id: string;
  readonly workProductId: string;
  readonly taskScopeRevision: number;
  readonly content: string;
  readonly contentFormat: 'plain_text' | 'markdown';
  readonly contentSha256: string;
  readonly revisionSha256: string;
  readonly createdBy: string;
  readonly provenance: readonly WorkProductSourceReference[];
}

export interface RecordWorkProductReviewStoreInput {
  readonly id: string;
  readonly workProductId: string;
  readonly revisionId: string;
  readonly decision: 'approved' | 'rejected';
  readonly reason: string | null;
  readonly decidedBy: string;
}

export interface WorkProductStore<TTransaction> {
  createWorkProduct(
    tx: TTransaction,
    input: CreateWorkProductStoreInput,
  ): Promise<StoredWorkProduct>;

  findWorkProduct(tx: TTransaction, id: string): Promise<StoredWorkProduct | null>;

  listRevisions(
    tx: TTransaction,
    workProductId: string,
  ): Promise<readonly StoredWorkProductRevision[]>;

  appendRevision(
    tx: TTransaction,
    input: AppendWorkProductRevisionStoreInput,
  ): Promise<StoredWorkProductRevision>;

  submitRevision(
    tx: TTransaction,
    workProductId: string,
    revisionId: string,
  ): Promise<StoredWorkProduct | null>;

  recordReview(
    tx: TTransaction,
    input: RecordWorkProductReviewStoreInput,
  ): Promise<StoredWorkProductReview | null>;

  archiveWorkProduct(tx: TTransaction, workProductId: string): Promise<StoredWorkProduct | null>;
}
