import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';
import { randomUUID } from 'node:crypto';

import { KnowledgeSourceId, type KnowledgeSource } from '../domain/source.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';
import { auditActor } from './helpers.js';

export interface CreateKnowledgeSourceCommand {
  readonly name: string;
  readonly description?: string | null;
}

export async function createKnowledgeSource(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  command: CreateKnowledgeSourceCommand,
): Promise<KnowledgeSource> {
  enforce(authz, 'knowledge:source:create');

  const created = await store.createSource(tx, {
    id: KnowledgeSourceId.parse(randomUUID()),
    name: command.name,
    ...(command.description === undefined ? {} : { description: command.description }),
  });

  await recordAuditEvent(tx, {
    ...auditActor(authz),
    action: 'knowledge.source_created',
    outcome: 'success',
    resourceType: 'knowledge_source',
    resourceId: created.id,
  });

  return created;
}
