import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import { enforce, type AuthzContext } from '@legalintel/iam';

import type { Matter, MatterId, MatterStatus } from '../domain/matter.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';
import { workspaceActor, workspaceNotFound } from './helpers.js';

export interface UpdateMatterRequest {
  readonly name?: string;
  readonly reference?: string | null;
  readonly status?: MatterStatus;
}

export interface UpdateMatterDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
}

export async function updateMatter(
  dependencies: UpdateMatterDependencies,
  tx: Tx,
  context: AuthzContext,
  matterId: MatterId,
  request: UpdateMatterRequest,
): Promise<Matter> {
  enforce(context, 'matter:update');

  const matter = await dependencies.workspaceStore.updateMatter(tx, matterId, request);

  if (matter === null) {
    throw workspaceNotFound('workspace.matter_not_found');
  }

  await recordAuditEvent(tx, {
    ...workspaceActor(context),
    action: 'workspace.matter_updated',
    outcome: 'success',
    resourceType: 'matter',
    resourceId: matter.id,
    metadata: {
      clientId: matter.clientId,
      jurisdictionId: matter.jurisdictionId,
      status: matter.status,
    },
  });

  return matter;
}
