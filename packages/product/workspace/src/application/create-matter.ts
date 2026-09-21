import { recordAuditEvent } from '@legalintel/audit';
import { PgEntitlementStore, resolveAuthorizedJurisdiction } from '@legalintel/entitlements';
import { enforce, type AuthzContext } from '@legalintel/iam';
import type { Tx } from '@legalintel/db';

import type { ClientId } from '../domain/client.js';
import type { Matter } from '../domain/matter.js';
import type { WorkspaceStore } from '../ports/workspace-store.js';
import { workspaceActor } from './helpers.js';

export interface CreateMatterRequest {
  readonly clientId: ClientId;
  readonly name: string;
  readonly reference?: string | null;
  readonly jurisdiction?: string | null;
  readonly openedAt?: Date | null;
}

export interface CreateMatterDependencies {
  readonly workspaceStore: WorkspaceStore<Tx>;
  readonly entitlementStore?: PgEntitlementStore;
}

export async function createMatter(
  dependencies: CreateMatterDependencies,
  tx: Tx,
  context: AuthzContext,
  request: CreateMatterRequest,
): Promise<Matter> {
  enforce(context, 'matter:create');

  const client = await dependencies.workspaceStore.findClientById(tx, request.clientId);

  if (client === null) {
    const error = new Error('workspace.client_not_found');
    error.name = 'workspace.client_not_found';
    throw error;
  }

  const entitlementStore = dependencies.entitlementStore ?? new PgEntitlementStore();

  const jurisdictionId = await resolveAuthorizedJurisdiction(
    entitlementStore,
    tx,
    request.jurisdiction,
  );

  const matter = await dependencies.workspaceStore.createMatter(tx, {
    clientId: request.clientId,
    jurisdictionId,
    name: request.name,
    ...(request.reference == null ? {} : { reference: request.reference }),
    ...(request.openedAt == null ? {} : { openedAt: request.openedAt }),
  });

  await recordAuditEvent(tx, {
    ...workspaceActor(context),
    action: 'workspace.matter_created',
    outcome: 'success',
    resourceType: 'matter',
    resourceId: matter.id,
    metadata: {
      clientId: matter.clientId,
      jurisdictionId: matter.jurisdictionId,
    },
  });

  return matter;
}
