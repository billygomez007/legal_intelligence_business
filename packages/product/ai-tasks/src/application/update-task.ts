import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';
import { validationError } from '@legalintel/kernel';

import type { AiTaskStore, StoredAiTask } from '../ports/ai-task-store.js';
import { auditAiTaskMutation, requireAiTask, requireTaskPermission } from './helpers.js';

export interface UpdateAiTaskRequest {
  readonly id: string;
  readonly title?: string;
  readonly instructions?: string;
}

export async function updateAiTask(
  store: AiTaskStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  request: UpdateAiTaskRequest,
): Promise<StoredAiTask> {
  requireTaskPermission(context, 'ai_task:update');

  if (request.title === undefined && request.instructions === undefined) {
    throw validationError('ai_task.no_update', 'At least one AI task field must be updated.');
  }

  const current = await requireAiTask(store, tx, request.id);

  if (current.status !== 'draft') {
    throw validationError('ai_task.not_editable', 'Only draft AI tasks may be edited.');
  }

  const updated = await store.updateTaskDefinition(tx, request.id, {
    ...(request.title === undefined
      ? {}
      : {
          title: request.title,
        }),
    ...(request.instructions === undefined
      ? {}
      : {
          instructions: request.instructions,
        }),
  });

  if (updated === null) {
    return requireAiTask(store, tx, request.id);
  }

  await auditAiTaskMutation(tx, context, {
    action: 'ai_task.updated',
    taskId: updated.id,
    metadata: {
      titleChanged: request.title !== undefined,
      instructionsChanged: request.instructions !== undefined,
    },
  });

  return updated;
}
