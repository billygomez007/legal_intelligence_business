import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import type { AiTaskStore, StoredAiTask } from '../ports/ai-task-store.js';
import { requireTaskPermission } from './helpers.js';

export async function listAiTasks(
  store: AiTaskStore<Tx>,
  tx: Tx,
  context: AuthzContext,
): Promise<readonly StoredAiTask[]> {
  requireTaskPermission(context, 'ai_task:read');

  return store.listTasks(tx);
}
