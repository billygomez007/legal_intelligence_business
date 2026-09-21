import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { Matter, MatterId } from '../domain/matter.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';
import { workspaceNotFound } from './helpers.js';

export interface GetMatterDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function getMatter(
  dependencies: GetMatterDependencies,
  tx: Tx,
  context: AuthzContext,
  matterId: MatterId,
): Promise<Matter> {
  enforce(context, 'matter:read');

  const matter = await dependencies.workspaceStore.findMatterById(tx, matterId);

  if (matter === null) {
    throw workspaceNotFound('workspace.matter_not_found');
  }

  return matter;
}
