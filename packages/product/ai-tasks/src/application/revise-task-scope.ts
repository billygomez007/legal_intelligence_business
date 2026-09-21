import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';
import { validationError } from '@legalintel/kernel';

import type { StoredAiTask } from '../ports/ai-task-store.js';
import {
  auditAiTaskMutation,
  authorizeAiTaskScope,
  requireActingUser,
  requireAiTask,
  requireTaskPermission,
  type AiTaskApplicationDependencies,
  type AiTaskScopeRequest,
} from './helpers.js';

export interface ReviseAiTaskScopeRequest {
  readonly id: string;
  readonly scope: AiTaskScopeRequest;
}

export async function reviseAiTaskScope(
  dependencies: AiTaskApplicationDependencies,
  tx: Tx,
  context: AuthzContext,
  request: ReviseAiTaskScopeRequest,
): Promise<StoredAiTask> {
  requireTaskPermission(context, 'ai_task:update');

  const current = await requireAiTask(dependencies.taskStore, tx, request.id);

  if (current.status !== 'draft') {
    throw validationError('ai_task.scope_frozen', 'Only draft AI tasks may revise scope.');
  }

  const createdByUserId = requireActingUser(context);

  const scope = await authorizeAiTaskScope(dependencies, tx, context, request.scope);

  const updated = await dependencies.taskStore.appendScopeRevision(tx, request.id, {
    ...scope,
    createdByUserId,
  });

  if (updated === null) {
    return requireAiTask(dependencies.taskStore, tx, request.id);
  }

  await auditAiTaskMutation(tx, context, {
    action: 'ai_task.scope_revised',
    taskId: updated.id,
    metadata: {
      revision: updated.currentScopeRevision,
      scopeMode: updated.scope.scopeMode,
      jurisdictionId: updated.scope.jurisdictionId,
      matterId: updated.scope.matterId,
    },
  });

  return updated;
}
