import type { AuthzContext } from '@legalintel/iam';

import type { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import {
  auditMatterDocumentMutation,
  MatterDocumentNotFoundError,
  requireMatterDocumentPermission,
} from './helpers';

export interface UpdateMatterDocumentRequest {
  readonly id: MatterDocumentId;
  readonly name: string;
  readonly description?: string | null;
}

export async function updateMatterDocument<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  request: UpdateMatterDocumentRequest,
) {
  requireMatterDocumentPermission(context, 'matter-document:update');

  const updated = await store.updateDocument(tx, {
    id: request.id,
    name: request.name,
    ...(request.description !== undefined ? { description: request.description } : {}),
  });

  if (updated === null) {
    throw new MatterDocumentNotFoundError();
  }

  await auditMatterDocumentMutation(
    tx as Parameters<typeof auditMatterDocumentMutation>[0],
    context,
    {
      action: 'matter_document.updated',
      resourceType: 'matter_document',
      resourceId: updated.id,
      metadata: {
        matterId: updated.matterId,
      },
    },
  );

  return updated;
}
