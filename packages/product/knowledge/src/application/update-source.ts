import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { KnowledgeSource, KnowledgeSourceId } from '../domain/source.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';
import { auditActor, knowledgeNotFound } from './helpers.js';

export interface UpdateKnowledgeSourceCommand {
  readonly id: KnowledgeSourceId;
  readonly name: string;
  readonly description?: string | null;
}

export async function updateKnowledgeSource(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  command: UpdateKnowledgeSourceCommand,
): Promise<KnowledgeSource> {
  enforce(authz, 'knowledge:source:update');

  const updated = await store.updateSource(tx, command);

  if (updated === null) {
    throw knowledgeNotFound();
  }

  await recordAuditEvent(tx, {
    ...auditActor(authz),
    action: 'knowledge.source_updated',
    outcome: 'success',
    resourceType: 'knowledge_source',
    resourceId: updated.id,
  });

  return updated;
}
