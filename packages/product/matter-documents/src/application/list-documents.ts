import type { AuthzContext } from '@legalintel/iam';

import type { MatterDocumentStatus } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import { requireMatterDocumentPermission } from './helpers';

export async function listMatterDocuments<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  matterId: string,
  status?: MatterDocumentStatus,
) {
  requireMatterDocumentPermission(context, 'matter-document:read');
  return store.listDocuments(tx, matterId, status);
}
