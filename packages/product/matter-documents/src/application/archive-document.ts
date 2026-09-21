import type { AuthzContext } from '@legalintel/iam';

import type { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import {
  auditMatterDocumentMutation,
  MatterDocumentNotFoundError,
  requireMatterDocumentPermission,
} from './helpers';

export async function archiveMatterDocument<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  id: MatterDocumentId,
) {
  requireMatterDocumentPermission(context, 'matter-document:update');

  const archived = await store.setDocumentStatus(tx, id, 'archived');

  if (archived === null) {
    throw new MatterDocumentNotFoundError();
  }

  await auditMatterDocumentMutation(
    tx as Parameters<typeof auditMatterDocumentMutation>[0],
    context,
    {
      action: 'matter_document.archived',
      resourceType: 'matter_document',
      resourceId: archived.id,
      metadata: {
        matterId: archived.matterId,
      },
    },
  );

  return archived;
}
