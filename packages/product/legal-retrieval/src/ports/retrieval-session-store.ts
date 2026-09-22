import type {
  RetrievalEvidence,
  RetrievalQuery,
} from '../domain/retrieval.js';

export interface RetrievalSessionRecordInput {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskScopeRevision: number;
  readonly jurisdictionId: string;
  readonly matterId: string | null;
  readonly scopeMode: string;
  readonly query: RetrievalQuery;
  readonly evidence: readonly RetrievalEvidence[];
  readonly createdBy: string;
}

export interface RetrievalSessionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskScopeRevision: number;
  readonly jurisdictionId: string;
  readonly matterId: string | null;
  readonly scopeMode: string;
  readonly queryFingerprint: string;
  readonly requestedLimit: number;
  readonly resultCount: number;
  readonly createdBy: string;
}

export interface RetrievalSessionStore<
  TTransaction = unknown,
> {
  record(
    tx: TTransaction,
    input: RetrievalSessionRecordInput,
  ): Promise<RetrievalSessionRecord>;
}
