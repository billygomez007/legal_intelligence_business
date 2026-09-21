import { recordAuditEvent } from '@legalintel/audit';
import type { Tx } from '@legalintel/db';
import {
  PgEntitlementStore,
  resolveAuthorizedJurisdiction,
  type EntitlementStore,
} from '@legalintel/entitlements';
import { actingUserId, enforce, type AuthzContext } from '@legalintel/iam';
import { notFound, validationError } from '@legalintel/kernel';
import { MatterId, pgWorkspaceStore, type WorkspaceStore } from '@legalintel/workspace';

import type {
  AiTaskStore,
  StoredAiTask,
  StoredAiTaskScopeMode,
  StoredAiTaskScopeRevision,
} from '../ports/ai-task-store.js';

export interface AiTaskApplicationDependencies {
  readonly taskStore: AiTaskStore<Tx>;
  readonly entitlementStore?: EntitlementStore<Tx>;
  readonly workspaceStore?: WorkspaceStore<Tx>;
}

export interface AiTaskScopeRequest {
  readonly mode: StoredAiTaskScopeMode;
  readonly matterId?: string | null;
  readonly jurisdiction?: string | null;
}

const matterModes = new Set<StoredAiTaskScopeMode>([
  'ghana_corpus_and_matter',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);

const firmKnowledgeModes = new Set<StoredAiTaskScopeMode>([
  'ghana_corpus_and_firm_knowledge',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);

export function requireTaskPermission(
  context: AuthzContext,
  permission: 'ai_task:create' | 'ai_task:read' | 'ai_task:update' | 'ai_task:transition',
): void {
  enforce(context, permission);
}

export function requireActingUser(context: AuthzContext): string {
  const actor = actingUserId(context);

  if (actor === null) {
    throw validationError('ai_task.human_actor_required', 'AI tasks require a human acting user.');
  }

  return actor;
}

export async function requireAiTask(
  store: AiTaskStore<Tx>,
  tx: Tx,
  taskId: string,
): Promise<StoredAiTask> {
  const task = await store.findTask(tx, taskId);

  if (task === null) {
    throw notFound('ai_task.not_found', 'The requested AI task was not found.');
  }

  return task;
}

export async function authorizeAiTaskScope(
  dependencies: AiTaskApplicationDependencies,
  tx: Tx,
  context: AuthzContext,
  request: AiTaskScopeRequest,
): Promise<{
  readonly jurisdictionId: string;
  readonly jurisdictionCode: 'GH';
  readonly scopeMode: StoredAiTaskScopeMode;
  readonly matterId: string | null;
}> {
  const entitlementStore = dependencies.entitlementStore ?? new PgEntitlementStore();

  const jurisdictionId = await resolveAuthorizedJurisdiction(
    entitlementStore,
    tx,
    request.jurisdiction,
  );

  const needsMatter = matterModes.has(request.mode);

  const needsFirmKnowledge = firmKnowledgeModes.has(request.mode);

  if (
    needsMatter &&
    (request.matterId === undefined || request.matterId === null || request.matterId === '')
  ) {
    throw validationError(
      'ai_task.matter_required',
      'This AI task scope requires a selected matter.',
    );
  }

  if (!needsMatter && request.matterId != null) {
    throw validationError(
      'ai_task.matter_not_allowed',
      'This AI task scope does not accept a selected matter.',
    );
  }

  if (needsFirmKnowledge) {
    enforce(context, 'knowledge:source:read');

    enforce(context, 'knowledge:version:read');
  }

  let matterId: string | null = null;

  if (needsMatter) {
    enforce(context, 'matter:read');

    const parsedMatterId = MatterId.parse(request.matterId);

    const workspaceStore = dependencies.workspaceStore ?? pgWorkspaceStore;

    const matter = await workspaceStore.findMatterById(tx, parsedMatterId);

    if (matter === null) {
      throw notFound('ai_task.matter_not_found', 'The selected matter was not found.');
    }

    if (String(matter.jurisdictionId) !== String(jurisdictionId)) {
      throw notFound('ai_task.matter_not_found', 'The selected matter was not found.');
    }

    matterId = String(matter.id);
  }

  return {
    jurisdictionId: String(jurisdictionId),
    jurisdictionCode: 'GH',
    scopeMode: request.mode,
    matterId,
  };
}

export async function reauthorizeCurrentAiTaskScope(
  dependencies: AiTaskApplicationDependencies,
  tx: Tx,
  context: AuthzContext,
  scope: StoredAiTaskScopeRevision,
): Promise<void> {
  const authorized = await authorizeAiTaskScope(dependencies, tx, context, {
    mode: scope.scopeMode,
    matterId: scope.matterId,
    jurisdiction: scope.jurisdictionCode,
  });

  if (authorized.jurisdictionId !== scope.jurisdictionId) {
    throw validationError(
      'ai_task.scope_no_longer_authorized',
      'The AI task scope is no longer authorized.',
    );
  }
}

function auditActor(context: AuthzContext):
  | {
      readonly actorKind: 'user';
      readonly actorId: string;
    }
  | {
      readonly actorKind: 'api_key';
      readonly actorId: string;
    }
  | {
      readonly actorKind: 'system';
    } {
  switch (context.principal.kind) {
    case 'user':
      return {
        actorKind: 'user',
        actorId: context.principal.userId,
      };

    case 'api_key':
      return {
        actorKind: 'api_key',
        actorId: context.principal.createdBy,
      };

    case 'system':
      return {
        actorKind: 'system',
      };
  }
}

export async function auditAiTaskMutation(
  tx: Tx,
  context: AuthzContext,
  input: {
    readonly action:
      | 'ai_task.created'
      | 'ai_task.updated'
      | 'ai_task.scope_revised'
      | 'ai_task.ready'
      | 'ai_task.cancelled';
    readonly taskId: string;
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  },
): Promise<void> {
  await recordAuditEvent(tx, {
    ...auditActor(context),
    action: input.action,
    outcome: 'success',
    resourceType: 'ai_task',
    resourceId: input.taskId,
    metadata: input.metadata ?? {},
  });
}
