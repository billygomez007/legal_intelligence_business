import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { KnowledgeSource, KnowledgeSourceId } from '../domain/source.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';
import { knowledgeNotFound } from './helpers.js';

export async function getKnowledgeSource(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  id: KnowledgeSourceId,
): Promise<KnowledgeSource> {
  enforce(authz, 'knowledge:source:read');

  const source = await store.findSource(tx, id);

  if (source === null) {
    throw knowledgeNotFound();
  }

  return source;
}
