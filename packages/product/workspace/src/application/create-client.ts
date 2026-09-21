import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { Client } from '../domain/client.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';
import { workspaceActor } from './helpers.js';

export interface CreateClientRequest {
  readonly name: string;
  readonly reference?: string | null;
}

export interface CreateClientDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function createClient(
  dependencies: CreateClientDependencies,
  tx: Tx,
  context: AuthzContext,
  request: CreateClientRequest,
): Promise<Client> {
  enforce(context, 'client:create');

  const client = await dependencies.workspaceStore.createClient(tx, {
    name: request.name,
    ...(request.reference == null ? {} : { reference: request.reference }),
  });

  await recordAuditEvent(tx, {
    ...workspaceActor(context),
    action: 'workspace.client_created',
    outcome: 'success',
    resourceType: 'client',
    resourceId: client.id,
  });

  return client;
}
