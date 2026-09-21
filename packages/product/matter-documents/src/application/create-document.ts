import { randomUUID } from 'node:crypto';

import type { AuthzContext } from '@legalintel/iam';

import { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import { auditMatterDocumentMutation, requireMatterDocumentPermission } from './helpers';

export interface CreateMatterDocumentRequest {
  readonly matterId: string;
  readonly name: string;
  readonly description?: string | null;
}

export async function createMatterDocument<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  request: CreateMatterDocumentRequest,
) {
  requireMatterDocumentPermission(context, 'matter-document:create');

  const document = await store.createDocument(tx, {
    id: MatterDocumentId.parse(randomUUID()),
    matterId: request.matterId,
    name: request.name,
    ...(request.description !== undefined ? { description: request.description } : {}),
  });

  await auditMatterDocumentMutation(
    tx as Parameters<typeof auditMatterDocumentMutation>[0],
    context,
    {
      action: 'matter_document.created',
      resourceType: 'matter_document',
      resourceId: document.id,
      metadata: {
        matterId: document.matterId,
      },
    },
  );

  return document;
}
