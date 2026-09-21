import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';
import { validationError } from '@legalintel/kernel';

import type { StoredAiTask } from '../ports/ai-task-store.js';
import {
  auditAiTaskMutation,
  reauthorizeCurrentAiTaskScope,
  requireAiTask,
  requireTaskPermission,
  type AiTaskApplicationDependencies,
} from './helpers.js';

export async function markAiTaskReady(
  dependencies: AiTaskApplicationDependencies,
  tx: Tx,
  context: AuthzContext,
  taskId: string,
): Promise<StoredAiTask> {
  requireTaskPermission(context, 'ai_task:transition');

  const current = await requireAiTask(dependencies.taskStore, tx, taskId);

  if (current.status !== 'draft') {
    throw validationError(
      'ai_task.invalid_ready_transition',
      'Only draft AI tasks may be marked ready.',
    );
  }

  await reauthorizeCurrentAiTaskScope(dependencies, tx, context, current.scope);

  const updated = await dependencies.taskStore.transitionTask(tx, taskId, 'ready');

  if (updated === null) {
    return requireAiTask(dependencies.taskStore, tx, taskId);
  }

  await auditAiTaskMutation(tx, context, {
    action: 'ai_task.ready',
    taskId: updated.id,
    metadata: {
      scopeRevision: updated.currentScopeRevision,
      scopeMode: updated.scope.scopeMode,
      jurisdictionId: updated.scope.jurisdictionId,
      matterId: updated.scope.matterId,
    },
  });

  return updated;
}
