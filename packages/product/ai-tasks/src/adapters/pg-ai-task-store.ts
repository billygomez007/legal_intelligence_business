import type { Tx } from '@legalintel/db';

import type {
  AiTaskStore,
  AppendAiTaskScopeStoreInput,
  CreateAiTaskStoreInput,
  StoredAiEmployeeType,
  StoredAiTask,
  StoredAiTaskScopeMode,
  StoredAiTaskScopeRevision,
  StoredAiTaskStatus,
  UpdateAiTaskDefinitionStoreInput,
} from '../ports/ai-task-store.js';

interface TaskWithScopeRow {
  readonly organization_id: string;
  readonly id: string;
  readonly requested_by_user_id: string;
  readonly employee_type: StoredAiEmployeeType;
  readonly title: string;
  readonly instructions: string;
  readonly status: StoredAiTaskStatus;
  readonly current_scope_revision: number;
  readonly task_created_at: Date;
  readonly task_updated_at: Date;
  readonly revision: number;
  readonly jurisdiction_id: string;
  readonly jurisdiction_code: 'GH';
  readonly scope_mode: StoredAiTaskScopeMode;
  readonly matter_id: string | null;
  readonly created_by_user_id: string;
  readonly scope_created_at: Date;
}

interface ScopeRow {
  readonly organization_id: string;
  readonly task_id: string;
  readonly revision: number;
  readonly jurisdiction_id: string;
  readonly jurisdiction_code: 'GH';
  readonly scope_mode: StoredAiTaskScopeMode;
  readonly matter_id: string | null;
  readonly created_by_user_id: string;
  readonly created_at: Date;
}

const CURRENT_TASK_SELECT = `
  SELECT
    t.organization_id,
    t.id,
    t.requested_by_user_id,
    t.employee_type,
    t.title,
    t.instructions,
    t.status,
    t.current_scope_revision,
    t.created_at AS task_created_at,
    t.updated_at AS task_updated_at,
    s.revision,
    s.jurisdiction_id,
    s.jurisdiction_code,
    s.scope_mode,
    s.matter_id,
    s.created_by_user_id,
    s.created_at AS scope_created_at
  FROM ai_tasks.tasks t
  JOIN ai_tasks.task_scope_revisions s
    ON s.organization_id = t.organization_id
   AND s.task_id = t.id
   AND s.revision = t.current_scope_revision
`;

function mapScope(row: ScopeRow): StoredAiTaskScopeRevision {
  return {
    organizationId: row.organization_id,
    taskId: row.task_id,
    revision: row.revision,
    jurisdictionId: row.jurisdiction_id,
    jurisdictionCode: row.jurisdiction_code,
    scopeMode: row.scope_mode,
    matterId: row.matter_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function mapTask(row: TaskWithScopeRow): StoredAiTask {
  return {
    organizationId: row.organization_id,
    id: row.id,
    requestedByUserId: row.requested_by_user_id,
    employeeType: row.employee_type,
    title: row.title,
    instructions: row.instructions,
    status: row.status,
    currentScopeRevision: row.current_scope_revision,
    createdAt: row.task_created_at,
    updatedAt: row.task_updated_at,
    scope: {
      organizationId: row.organization_id,
      taskId: row.id,
      revision: row.revision,
      jurisdictionId: row.jurisdiction_id,
      jurisdictionCode: row.jurisdiction_code,
      scopeMode: row.scope_mode,
      matterId: row.matter_id,
      createdByUserId: row.created_by_user_id,
      createdAt: row.scope_created_at,
    },
  };
}

export class PgAiTaskStore implements AiTaskStore<Tx> {
  async createTask(tx: Tx, input: CreateAiTaskStoreInput): Promise<StoredAiTask> {
    await tx.query(
      `INSERT INTO ai_tasks.tasks (
         organization_id,
         id,
         requested_by_user_id,
         employee_type,
         title,
         instructions
       )
       VALUES (
         app.current_org_id(),
         $1,
         $2,
         $3,
         $4,
         $5
       )`,
      [input.id, input.requestedByUserId, input.employeeType, input.title, input.instructions],
    );

    await tx.query(
      `INSERT INTO ai_tasks.task_scope_revisions (
         organization_id,
         task_id,
         revision,
         jurisdiction_id,
         jurisdiction_code,
         scope_mode,
         matter_id,
         created_by_user_id
       )
       VALUES (
         app.current_org_id(),
         $1,
         1,
         $2,
         $3,
         $4,
         $5,
         $6
       )`,
      [
        input.id,
        input.scope.jurisdictionId,
        input.scope.jurisdictionCode,
        input.scope.scopeMode,
        input.scope.matterId,
        input.scope.createdByUserId,
      ],
    );

    const created = await this.findTask(tx, input.id);

    if (created === null) {
      throw new Error('ai_tasks.create_task_no_row');
    }

    return created;
  }

  async findTask(tx: Tx, taskId: string): Promise<StoredAiTask | null> {
    const result = await tx.query<TaskWithScopeRow>(
      `${CURRENT_TASK_SELECT}
         WHERE t.organization_id = app.current_org_id()
           AND t.id = $1`,
      [taskId],
    );

    const row = result.rows[0];

    return row === undefined ? null : mapTask(row);
  }

  async listTasks(tx: Tx): Promise<readonly StoredAiTask[]> {
    const result = await tx.query<TaskWithScopeRow>(
      `${CURRENT_TASK_SELECT}
         WHERE t.organization_id = app.current_org_id()
         ORDER BY t.created_at DESC, t.id DESC`,
    );

    return result.rows.map(mapTask);
  }

  async updateTaskDefinition(
    tx: Tx,
    taskId: string,
    input: UpdateAiTaskDefinitionStoreInput,
  ): Promise<StoredAiTask | null> {
    const result = await tx.query<{
      readonly id: string;
    }>(
      `UPDATE ai_tasks.tasks
       SET
         title = CASE
           WHEN $2::boolean THEN $3::text
           ELSE title
         END,
         instructions = CASE
           WHEN $4::boolean THEN $5::text
           ELSE instructions
         END
       WHERE organization_id = app.current_org_id()
         AND id = $1
       RETURNING id`,
      [
        taskId,
        input.title !== undefined,
        input.title ?? null,
        input.instructions !== undefined,
        input.instructions ?? null,
      ],
    );

    if (result.rows[0] === undefined) {
      return null;
    }

    return this.findTask(tx, taskId);
  }

  async appendScopeRevision(
    tx: Tx,
    taskId: string,
    input: AppendAiTaskScopeStoreInput,
  ): Promise<StoredAiTask | null> {
    const parent = await tx.query<{
      readonly current_scope_revision: number;
    }>(
      `SELECT current_scope_revision
       FROM ai_tasks.tasks
       WHERE organization_id = app.current_org_id()
         AND id = $1
       FOR UPDATE`,
      [taskId],
    );

    const parentRow = parent.rows[0];

    if (parentRow === undefined) {
      return null;
    }

    const revision = parentRow.current_scope_revision + 1;

    await tx.query(
      `INSERT INTO ai_tasks.task_scope_revisions (
         organization_id,
         task_id,
         revision,
         jurisdiction_id,
         jurisdiction_code,
         scope_mode,
         matter_id,
         created_by_user_id
       )
       VALUES (
         app.current_org_id(),
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7
       )`,
      [
        taskId,
        revision,
        input.jurisdictionId,
        input.jurisdictionCode,
        input.scopeMode,
        input.matterId,
        input.createdByUserId,
      ],
    );

    await tx.query(
      `UPDATE ai_tasks.tasks
       SET current_scope_revision = $2
       WHERE organization_id = app.current_org_id()
         AND id = $1`,
      [taskId, revision],
    );

    return this.findTask(tx, taskId);
  }

  async transitionTask(
    tx: Tx,
    taskId: string,
    status: StoredAiTaskStatus,
  ): Promise<StoredAiTask | null> {
    const result = await tx.query<{
      readonly id: string;
    }>(
      `UPDATE ai_tasks.tasks
       SET status = $2
       WHERE organization_id = app.current_org_id()
         AND id = $1
       RETURNING id`,
      [taskId, status],
    );

    if (result.rows[0] === undefined) {
      return null;
    }

    return this.findTask(tx, taskId);
  }

  async listScopeRevisions(tx: Tx, taskId: string): Promise<readonly StoredAiTaskScopeRevision[]> {
    const result = await tx.query<ScopeRow>(
      `SELECT
           organization_id,
           task_id,
           revision,
           jurisdiction_id,
           jurisdiction_code,
           scope_mode,
           matter_id,
           created_by_user_id,
           created_at
         FROM ai_tasks.task_scope_revisions
         WHERE organization_id = app.current_org_id()
           AND task_id = $1
         ORDER BY revision ASC`,
      [taskId],
    );

    return result.rows.map(mapScope);
  }
}

export const pgAiTaskStore = new PgAiTaskStore();
