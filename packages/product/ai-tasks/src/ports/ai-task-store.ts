export type StoredAiEmployeeType =
  'research_associate' | 'ai_paralegal' | 'matter_manager' | 'contract_analyst';

export type StoredAiTaskStatus = 'draft' | 'ready' | 'cancelled';

export type StoredAiTaskScopeMode =
  | 'ghana_corpus'
  | 'ghana_corpus_and_firm_knowledge'
  | 'ghana_corpus_and_matter'
  | 'ghana_corpus_and_matter_and_firm_knowledge';

export interface StoredAiTaskScopeRevision {
  readonly organizationId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly jurisdictionId: string;
  readonly jurisdictionCode: 'GH';
  readonly scopeMode: StoredAiTaskScopeMode;
  readonly matterId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
}

export interface StoredAiTask {
  readonly organizationId: string;
  readonly id: string;
  readonly requestedByUserId: string;
  readonly employeeType: StoredAiEmployeeType;
  readonly title: string;
  readonly instructions: string;
  readonly status: StoredAiTaskStatus;
  readonly currentScopeRevision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly scope: StoredAiTaskScopeRevision;
}

export interface CreateAiTaskStoreInput {
  readonly id: string;
  readonly requestedByUserId: string;
  readonly employeeType: StoredAiEmployeeType;
  readonly title: string;
  readonly instructions: string;
  readonly scope: {
    readonly jurisdictionId: string;
    readonly jurisdictionCode: 'GH';
    readonly scopeMode: StoredAiTaskScopeMode;
    readonly matterId: string | null;
    readonly createdByUserId: string;
  };
}

export interface UpdateAiTaskDefinitionStoreInput {
  readonly title?: string;
  readonly instructions?: string;
}

export interface AppendAiTaskScopeStoreInput {
  readonly jurisdictionId: string;
  readonly jurisdictionCode: 'GH';
  readonly scopeMode: StoredAiTaskScopeMode;
  readonly matterId: string | null;
  readonly createdByUserId: string;
}

export interface AiTaskStore<TTransaction> {
  createTask(tx: TTransaction, input: CreateAiTaskStoreInput): Promise<StoredAiTask>;

  findTask(tx: TTransaction, taskId: string): Promise<StoredAiTask | null>;

  listTasks(tx: TTransaction): Promise<readonly StoredAiTask[]>;

  updateTaskDefinition(
    tx: TTransaction,
    taskId: string,
    input: UpdateAiTaskDefinitionStoreInput,
  ): Promise<StoredAiTask | null>;

  appendScopeRevision(
    tx: TTransaction,
    taskId: string,
    input: AppendAiTaskScopeStoreInput,
  ): Promise<StoredAiTask | null>;

  transitionTask(
    tx: TTransaction,
    taskId: string,
    status: StoredAiTaskStatus,
  ): Promise<StoredAiTask | null>;

  listScopeRevisions(
    tx: TTransaction,
    taskId: string,
  ): Promise<readonly StoredAiTaskScopeRevision[]>;
}
