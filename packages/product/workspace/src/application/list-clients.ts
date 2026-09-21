import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { Client } from '../domain/client.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';

export interface ListClientsDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function listClients(
  dependencies: ListClientsDependencies,
  tx: Tx,
  context: AuthzContext,
): Promise<readonly Client[]> {
  enforce(context, 'client:read');

  return dependencies.workspaceStore.listClients(tx);
}
