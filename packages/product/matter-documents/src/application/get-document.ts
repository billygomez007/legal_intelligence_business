import type { AuthzContext } from '@legalintel/iam';

import type { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import { requireMatterDocument, requireMatterDocumentPermission } from './helpers';

export async function getMatterDocument<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  id: MatterDocumentId,
) {
  requireMatterDocumentPermission(context, 'matter-document:read');
  return requireMatterDocument(store, tx, id);
}
