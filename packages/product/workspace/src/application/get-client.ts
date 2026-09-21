import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { Client, ClientId } from '../domain/client.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';
import { workspaceNotFound } from './helpers.js';

export interface GetClientDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function getClient(
  dependencies: GetClientDependencies,
  tx: Tx,
  context: AuthzContext,
  clientId: ClientId,
): Promise<Client> {
  enforce(context, 'client:read');

  const client = await dependencies.workspaceStore.findClientById(tx, clientId);

  if (client === null) {
    throw workspaceNotFound('workspace.client_not_found');
  }

  return client;
}
