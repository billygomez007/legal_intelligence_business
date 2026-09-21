import type { AuthzContext } from '@legalintel/iam';

import type { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import { requireMatterDocument, requireMatterDocumentPermission } from './helpers';

export async function listMatterDocumentVersions<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  documentId: MatterDocumentId,
) {
  requireMatterDocumentPermission(context, 'matter-document:version:read');

  await requireMatterDocument(store, tx, documentId);

  return store.listDocumentVersions(tx, documentId);
}
