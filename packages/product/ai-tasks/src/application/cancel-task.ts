import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';
import { validationError } from '@legalintel/kernel';

import type { AiTaskStore, StoredAiTask } from '../ports/ai-task-store.js';
import { auditAiTaskMutation, requireAiTask, requireTaskPermission } from './helpers.js';

export async function cancelAiTask(
  store: AiTaskStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  taskId: string,
): Promise<StoredAiTask> {
  requireTaskPermission(context, 'ai_task:transition');

  const current = await requireAiTask(store, tx, taskId);

  if (current.status === 'cancelled') {
    throw validationError('ai_task.already_cancelled', 'The AI task is already cancelled.');
  }

  const updated = await store.transitionTask(tx, taskId, 'cancelled');

  if (updated === null) {
    return requireAiTask(store, tx, taskId);
  }

  await auditAiTaskMutation(tx, context, {
    action: 'ai_task.cancelled',
    taskId: updated.id,
    metadata: {
      previousStatus: current.status,
    },
  });

  return updated;
}
