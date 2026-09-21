import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { KnowledgeSource, KnowledgeSourceStatus } from '../domain/source.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';

export async function listKnowledgeSources(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  status?: KnowledgeSourceStatus,
): Promise<readonly KnowledgeSource[]> {
  enforce(authz, 'knowledge:source:read');
  return store.listSources(tx, status);
}
