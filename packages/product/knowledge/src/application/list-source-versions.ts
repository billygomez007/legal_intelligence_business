import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { KnowledgeSourceId } from '../domain/source.js';
import type { KnowledgeSourceVersion } from '../domain/source-version.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';
import { knowledgeNotFound } from './helpers.js';

export async function listKnowledgeSourceVersions(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  sourceId: KnowledgeSourceId,
): Promise<readonly KnowledgeSourceVersion[]> {
  enforce(authz, 'knowledge:version:read');

  const source = await store.findSource(tx, sourceId);

  if (source === null) {
    throw knowledgeNotFound();
  }

  return store.listSourceVersions(tx, sourceId);
}
