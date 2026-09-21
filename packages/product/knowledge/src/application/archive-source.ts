import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { KnowledgeSource, KnowledgeSourceId } from '../domain/source.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';
import { auditActor, knowledgeNotFound } from './helpers.js';

export async function archiveKnowledgeSource(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  id: KnowledgeSourceId,
): Promise<KnowledgeSource> {
  enforce(authz, 'knowledge:source:update');

  const archived = await store.setSourceStatus(tx, id, 'archived');

  if (archived === null) {
    throw knowledgeNotFound();
  }

  await recordAuditEvent(tx, {
    ...auditActor(authz),
    action: 'knowledge.source_archived',
    outcome: 'success',
    resourceType: 'knowledge_source',
    resourceId: archived.id,
  });

  return archived;
}
