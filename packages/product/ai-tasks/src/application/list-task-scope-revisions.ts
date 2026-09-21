import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import type { AiTaskStore, StoredAiTaskScopeRevision } from '../ports/ai-task-store.js';
import { requireAiTask, requireTaskPermission } from './helpers.js';

export async function listAiTaskScopeRevisions(
  store: AiTaskStore<Tx>,
  tx: Tx,
  context: AuthzContext,
  taskId: string,
): Promise<readonly StoredAiTaskScopeRevision[]> {
  requireTaskPermission(context, 'ai_task:read');

  await requireAiTask(store, tx, taskId);

  return store.listScopeRevisions(tx, taskId);
}
