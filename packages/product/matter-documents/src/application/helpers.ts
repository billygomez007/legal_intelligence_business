import { recordAuditEvent } from '@legalintel/audit';
import type { AuthzContext } from '@legalintel/iam';

import type { MatterDocumentId } from '../domain/document';
import type { MatterDocumentStore } from '../ports/matter-document-store';

export class MatterDocumentNotFoundError extends Error {
  readonly code = 'matter_documents.document_not_found';

  constructor() {
    super('The requested matter document was not found.');
    this.name = 'MatterDocumentNotFoundError';
  }
}

export function requireMatterDocumentPermission(context: AuthzContext, permission: string): void {
  if (!context.permissions.has(permission)) {
    const error = new Error('Permission denied.') as Error & {
      code: string;
    };

    error.code = 'authz.denied';
    throw error;
  }
}

export async function requireMatterDocument<TTransaction>(
  store: MatterDocumentStore<TTransaction>,
  tx: TTransaction,
  id: MatterDocumentId,
) {
  const document = await store.findDocument(tx, id);

  if (document === null) {
    throw new MatterDocumentNotFoundError();
  }

  return document;
}

export function auditActor(context: AuthzContext) {
  switch (context.principal.kind) {
    case 'user':
      return {
        actorKind: 'user' as const,
        actorId: context.principal.userId,
      };

    case 'api_key':
      return {
        actorKind: 'api_key' as const,
        actorId: context.principal.createdBy,
      };

    case 'system':
      return {
        actorKind: 'system' as const,
      };
  }
}

export async function auditMatterDocumentMutation(
  tx: Parameters<typeof recordAuditEvent>[0],
  context: AuthzContext,
  input: {
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const actor = auditActor(context);

  await recordAuditEvent(tx, {
    ...actor,
    action: input.action,
    outcome: 'success',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ?? {},
  });
}
