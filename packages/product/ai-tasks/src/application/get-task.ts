import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import type { AiTaskStore, StoredAiTask } from '../ports/ai-task-store.js';
import { requireAiTask, requireTaskPermission } from './helpers.js';

export async function getAiTask(
  store: AiTaskStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  taskId: string,
): Promise<StoredAiTask> {
  requireTaskPermission(context, 'ai_task:read');

  return requireAiTask(store, tx, taskId);
}
