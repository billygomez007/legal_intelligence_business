import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { Client, ClientId, ClientStatus } from '../domain/client.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';
import { workspaceActor, workspaceNotFound } from './helpers.js';

export interface UpdateClientRequest {
  readonly name?: string;
  readonly reference?: string | null;
  readonly status?: ClientStatus;
}

export interface UpdateClientDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function updateClient(
  dependencies: UpdateClientDependencies,
  tx: Tx,
  context: AuthzContext,
  clientId: ClientId,
  request: UpdateClientRequest,
): Promise<Client> {
  enforce(context, 'client:update');

  const client = await dependencies.workspaceStore.updateClient(tx, clientId, request);

  if (client === null) {
    throw workspaceNotFound('workspace.client_not_found');
  }

  await recordAuditEvent(tx, {
    ...workspaceActor(context),
    action: 'workspace.client_updated',
    outcome: 'success',
    resourceType: 'client',
    resourceId: client.id,
    metadata: {
      status: client.status,
    },
  });

  return client;
}
