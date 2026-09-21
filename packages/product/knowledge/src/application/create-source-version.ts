import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';
import { randomUUID } from 'node:crypto';

import type { KnowledgeSourceId } from '../domain/source.js';
import { KnowledgeSourceVersionId, type KnowledgeSourceVersion } from '../domain/source-version.js';
import type { KnowledgeStore } from '../ports/knowledge-store.js';
import { auditActor, knowledgeNotFound } from './helpers.js';

export interface CreateKnowledgeSourceVersionCommand {
  readonly sourceId: KnowledgeSourceId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
}

export async function createKnowledgeSourceVersion(
  store: KnowledgeStore<Tx>,
  tx: Tx,
  authz: AuthzContext,
  command: CreateKnowledgeSourceVersionCommand,
): Promise<KnowledgeSourceVersion> {
  enforce(authz, 'knowledge:version:create');

  const source = await store.findSource(tx, command.sourceId);

  if (source === null) {
    throw knowledgeNotFound();
  }

  const created = await store.createSourceVersion(tx, {
    id: KnowledgeSourceVersionId.parse(randomUUID()),
    ...command,
  });

  await recordAuditEvent(tx, {
    ...auditActor(authz),
    action: 'knowledge.source_version_created',
    outcome: 'success',
    resourceType: 'knowledge_source_version',
    resourceId: created.id,
    metadata: {
      sourceId: created.sourceId,
      versionNumber: created.versionNumber,
      sizeBytes: created.sizeBytes,
    },
  });

  return created;
}
