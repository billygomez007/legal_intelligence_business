import { randomUUID } from 'node:crypto';

import type { AuthzContext } from '@legalintel/iam';

import { MatterDocumentVersionId } from '../domain/document-version';
import type { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';
import {
  auditMatterDocumentMutation,
  requireMatterDocument,
  requireMatterDocumentPermission,
} from './helpers';

export interface CreateMatterDocumentVersionRequest {
  readonly documentId: MatterDocumentId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly sizeBytes: number;
}

export async function createMatterDocumentVersion<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  context: AuthzContext,
  request: CreateMatterDocumentVersionRequest,
) {
  requireMatterDocumentPermission(context, 'matter-document:version:create');

  const document = await requireMatterDocument(store, tx, request.documentId);

  const version = await store.createDocumentVersion(tx, {
    id: MatterDocumentVersionId.parse(randomUUID()),
    matterId: document.matterId,
    documentId: document.id,
    originalFilename: request.originalFilename,
    mimeType: request.mimeType,
    storageKey: request.storageKey,
    contentSha256: request.contentSha256,
    sizeBytes: request.sizeBytes,
  });

  await auditMatterDocumentMutation(
    tx as Parameters<typeof auditMatterDocumentMutation>[0],
    context,
    {
      action: 'matter_document.version_created',
      resourceType: 'matter_document_version',
      resourceId: version.id,
      metadata: {
        matterId: version.matterId,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        sizeBytes: version.sizeBytes,
      },
    },
  );

  return version;
}
