import { randomUUID } from 'node:crypto';

import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import type { StoredAiEmployeeType, StoredAiTask } from '../ports/ai-task-store.js';
import {
  auditAiTaskMutation,
  authorizeAiTaskScope,
  requireActingUser,
  requireTaskPermission,
  type AiTaskApplicationDependencies,
  type AiTaskScopeRequest,
} from './helpers.js';

export interface CreateAiTaskRequest {
  readonly employeeType: StoredAiEmployeeType;
  readonly title: string;
  readonly instructions: string;
  readonly scope: AiTaskScopeRequest;
}

export async function createAiTask(
  dependencies: AiTaskApplicationDependencies,
  tx: Tx,
  context: AuthzContext,
  request: CreateAiTaskRequest,
): Promise<StoredAiTask> {
  requireTaskPermission(context, 'ai_task:create');

  const requestedByUserId = requireActingUser(context);

  const scope = await authorizeAiTaskScope(dependencies, tx, context, request.scope);

  const task = await dependencies.taskStore.createTask(tx, {
    id: randomUUID(),
    requestedByUserId,
    employeeType: request.employeeType,
    title: request.title,
    instructions: request.instructions,
    scope: {
      ...scope,
      createdByUserId: requestedByUserId,
    },
  });

  await auditAiTaskMutation(tx, context, {
    action: 'ai_task.created',
    taskId: task.id,
    metadata: {
      employeeType: task.employeeType,
      scopeMode: task.scope.scopeMode,
      jurisdictionId: task.scope.jurisdictionId,
      matterId: task.scope.matterId,
    },
  });

  return task;
}
