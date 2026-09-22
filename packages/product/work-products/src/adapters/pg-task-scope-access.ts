import { PgAiTaskStore } from '@legalintel/ai-tasks';
import type { Tx } from '@legalintel/db';
import { PgEntitlementStore, resolveAuthorizedJurisdiction } from '@legalintel/entitlements';
import { enforce, type AuthzContext } from '@legalintel/iam';
import { MatterId, pgWorkspaceStore } from '@legalintel/workspace';

import {
  requireWorkProductPermission,
  WorkProductAccessError,
} from '../authz/require-permission.js';

import { WorkProductPolicyError } from '../domain/review-policy.js';
import type { WorkProductScopeAuthorization } from '../ports/revision-source-reader.js';

type Task = NonNullable<Awaited<ReturnType<PgAiTaskStore['findTask']>>>;

export interface AuthorizedWorkProductTaskScope extends WorkProductScopeAuthorization {
  readonly jurisdictionId: string;
  readonly scopeMode: Task['scope']['scopeMode'];
}

/** Server-only dependencies. Overrides are for tests, not client requests. */
export interface WorkProductTaskScopeAccess {
  findTask(tx: Tx, taskId: string): Promise<Task | null>;
  authorizeGhana(tx: Tx): Promise<string>;

  findMatter(
    tx: Tx,
    matterId: string,
  ): Promise<{
    readonly id: string;
    readonly organizationId: string;
    readonly jurisdictionId: string;
  } | null>;
}

const databaseAccess: WorkProductTaskScopeAccess = {
  findTask: (tx, taskId) => new PgAiTaskStore().findTask(tx, taskId),

  authorizeGhana: async (tx) =>
    String(await resolveAuthorizedJurisdiction(new PgEntitlementStore(), tx, 'GH')),

  findMatter: async (tx, matterId) => {
    const matter = await pgWorkspaceStore.findMatterById(tx, MatterId.parse(matterId));

    return matter === null
      ? null
      : {
          id: String(matter.id),
          organizationId: matter.organizationId,
          jurisdictionId: String(matter.jurisdictionId),
        };
  },
};

const modes = new Set([
  'ghana_corpus',
  'ghana_corpus_and_firm_knowledge',
  'ghana_corpus_and_matter',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);

const matterModes = new Set([
  'ghana_corpus_and_matter',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);

const knowledgeModes = new Set([
  'ghana_corpus_and_firm_knowledge',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);

/**
 * Read and authorize the CURRENT ready task scope through existing stores.
 * A scope is identified by (organizationId, taskId, taskScopeRevision).
 * No synthetic scope-row ID is accepted.
 *
 * Returns null for unavailable resources. The caller must supply fresh IAM
 * context and an existing tenant transaction.
 *
 * This function does not authorize individual source versions, create a
 * transaction, persist a work product, or lock a task against concurrent changes.
 */
export async function readAuthorizedWorkProductTaskScope(
  tx: Tx,
  context: AuthzContext,
  taskId: string,
  taskScopeRevision: number,
  access: WorkProductTaskScopeAccess = databaseAccess,
): Promise<AuthorizedWorkProductTaskScope | null> {
  const organizationId = context.organizationId ?? '';

  const userId = requireWorkProductPermission(context, organizationId, 'work_product:read');

  enforce(context, 'ai_task:read');

  if (
    typeof taskId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(taskId) ||
    !Number.isSafeInteger(taskScopeRevision) ||
    taskScopeRevision < 1
  ) {
    throw new WorkProductPolicyError('work_product.invalid_task_scope_reference');
  }

  const session = await tx.query<{
    organization_id: string | null;
    user_id: string | null;
  }>(
    'SELECT app.current_org_id()::text AS organization_id, app.current_user_id()::text AS user_id',
  );

  if (
    session.rows.length !== 1 ||
    session.rows[0]?.organization_id !== organizationId ||
    session.rows[0].user_id !== userId
  ) {
    throw new WorkProductAccessError();
  }

  const task = await access.findTask(tx, taskId);

  if (
    task?.id !== taskId ||
    task.organizationId !== organizationId ||
    task.status !== 'ready' ||
    task.currentScopeRevision !== taskScopeRevision ||
    task.scope.organizationId !== organizationId ||
    task.scope.taskId !== taskId ||
    task.scope.revision !== taskScopeRevision ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate runtime inputs and database results even when their declared types are narrower.
    task.scope.jurisdictionCode !== 'GH' ||
    !modes.has(task.scope.scopeMode)
  ) {
    return null;
  }

  // Capture the selected immutable scope before awaiting authorization services.
  const scope = Object.freeze({ ...task.scope });
  const needsMatter = matterModes.has(scope.scopeMode);

  if (needsMatter ? !scope.matterId : scope.matterId !== null) {
    return null;
  }

  const jurisdictionId = await access.authorizeGhana(tx);

  if (jurisdictionId !== scope.jurisdictionId) {
    return null;
  }

  if (knowledgeModes.has(scope.scopeMode)) {
    enforce(context, 'knowledge:source:read');
    enforce(context, 'knowledge:version:read');
  }

  if (needsMatter && scope.matterId !== null) {
    enforce(context, 'matter:read');

    const matter = await access.findMatter(tx, scope.matterId);

    if (
      matter?.id !== scope.matterId ||
      matter.organizationId !== organizationId ||
      matter.jurisdictionId !== jurisdictionId
    ) {
      return null;
    }
  }

  return Object.freeze({
    organizationId: String(organizationId),
    taskId,
    taskScopeRevision,
    jurisdictionId: scope.jurisdictionId,
    scopeMode: scope.scopeMode,
    matterId: scope.matterId,
    countryCode: 'GH',
    taskStatus: 'ready',
    permitted: true,
  });
}
