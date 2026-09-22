import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import {
  readAuthorizedWorkProductTaskScope,
  type WorkProductTaskScopeAccess,
} from '@legalintel/work-products';

import type {
  AuthorizedRetrievalScope,
} from '../domain/retrieval.js';

/**
 * Reuses the accepted Phase 7 AI Task authorization boundary.
 *
 * Retrieval is never allowed to construct an organization, matter,
 * jurisdiction, or task scope independently from the current AI Task.
 */
export async function authorizeRetrievalScope(
  tx: Tx,
  context: AuthzContext,
  taskId: string,
  taskScopeRevision: number,
  taskAccess?: WorkProductTaskScopeAccess,
): Promise<AuthorizedRetrievalScope | null> {
  const scope =
    await readAuthorizedWorkProductTaskScope(
      tx,
      context,
      taskId,
      taskScopeRevision,
      taskAccess,
    );

  if (
    scope === null
    || scope.permitted !== true
    || scope.countryCode !== 'GH'
    || scope.taskStatus !== 'ready'
  ) {
    return null;
  }

  return Object.freeze({
    organizationId:
      scope.organizationId,
    taskId:
      scope.taskId,
    taskScopeRevision:
      scope.taskScopeRevision,
    jurisdictionId:
      scope.jurisdictionId,
    countryCode: 'GH',
    matterId:
      scope.matterId,
    scopeMode:
      scope.scopeMode,
  });
}
