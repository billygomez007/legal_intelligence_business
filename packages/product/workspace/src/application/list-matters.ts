import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { ClientId } from '../domain/client.js';
import type { Matter } from '../domain/matter.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';

export interface ListMattersDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function listMatters(
  dependencies: ListMattersDependencies,
  tx: Tx,
  context: AuthzContext,
): Promise<readonly Matter[]> {
  enforce(context, 'matter:read');

  return dependencies.workspaceStore.listMatters(tx);
}

export async function listMattersForClient(
  dependencies: ListMattersDependencies,
  tx: Tx,
  context: AuthzContext,
  clientId: ClientId,
): Promise<readonly Matter[]> {
  enforce(context, 'matter:read');

  return dependencies.workspaceStore.listMattersForClient(tx, clientId);
}
