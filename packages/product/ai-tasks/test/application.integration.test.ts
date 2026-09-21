import type { AuthzContext } from '@legalintel/iam';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cancelAiTask,
  createAiTask,
  getAiTask,
  listAiTaskScopeRevisions,
  listAiTasks,
  markAiTaskReady,
  pgAiTaskStore,
  reviseAiTaskScope,
  updateAiTask,
  type StoredAiTaskScopeMode,
} from '../src';
import { createTaskWorld, type TaskWorld } from './support';

let w: TaskWorld;

beforeAll(async () => {
  w = await createTaskWorld();
});

afterAll(async () => {
  await w.database.dispose();
});

const aiTaskPermissions = [
  'ai_task:create',
  'ai_task:read',
  'ai_task:update',
  'ai_task:transition',
] as const;

const scopePermissions = [
  'matter:read',
  'knowledge:source:read',
  'knowledge:version:read',
] as const;

function userContext(
  organizationId: TaskWorld['orgA'],
  userId: TaskWorld['userA'],
  permissions: readonly string[],
): AuthzContext {
  return {
    principal: {
      kind: 'user',
      userId,
    },
    organizationId,
    permissions: new Set(permissions),
    roles: [],
  };
}

function orgAContext(permissions: readonly string[]): AuthzContext {
  return userContext(w.orgA, w.userA, permissions);
}

function orgBContext(permissions: readonly string[]): AuthzContext {
  return userContext(w.orgB, w.userB, permissions);
}

function fullContext(): AuthzContext {
  return orgAContext([...aiTaskPermissions, ...scopePermissions]);
}

const dependencies = () => ({
  taskStore: pgAiTaskStore,
});

const supportedScopes = [
  {
    mode: 'ghana_corpus',
    usesMatter: false,
  },
  {
    mode: 'ghana_corpus_and_firm_knowledge',
    usesMatter: false,
  },
  {
    mode: 'ghana_corpus_and_matter',
    usesMatter: true,
  },
  {
    mode: 'ghana_corpus_and_matter_and_firm_knowledge',
    usesMatter: true,
  },
] as const satisfies readonly {
  readonly mode: StoredAiTaskScopeMode;
  readonly usesMatter: boolean;
}[];

describe('Phase 6B AI Task application boundary', () => {
  it.each(supportedScopes)(
    'creates an authorized $mode task with canonical Ghana scope',
    async ({ mode, usesMatter }) => {
      const task = await w.run(w.orgA, (tx) =>
        createAiTask(dependencies(), tx, fullContext(), {
          employeeType: 'research_associate',
          title: `SYNTHETIC ${mode}`,
          instructions: 'SYNTHETIC application integration instructions',
          scope: {
            mode,
            ...(usesMatter
              ? {
                  matterId: String(w.matterA.id),
                }
              : {}),
          },
        }),
      );

      expect(task.status).toBe('draft');
      expect(task.currentScopeRevision).toBe(1);
      expect(task.scope.revision).toBe(1);
      expect(task.scope.jurisdictionCode).toBe('GH');
      expect(task.scope.jurisdictionId).toBe(String(w.gh));
      expect(task.scope.scopeMode).toBe(mode);
      expect(task.scope.matterId).toBe(usesMatter ? String(w.matterA.id) : null);

      const found = await w.run(w.orgA, (tx) =>
        getAiTask(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
      );

      expect(found.id).toBe(task.id);

      const listed = await w.run(w.orgA, (tx) =>
        listAiTasks(pgAiTaskStore, tx, orgAContext(['ai_task:read'])),
      );

      expect(listed.some((candidate) => candidate.id === task.id)).toBe(true);
    },
  );

  it('rejects creation before persistence when ai_task:create is absent', async () => {
    const before = await w.run(w.orgA, (tx) => pgAiTaskStore.listTasks(tx));

    await expect(
      w.run(w.orgA, (tx) =>
        createAiTask(dependencies(), tx, orgAContext(['ai_task:read']), {
          employeeType: 'ai_paralegal',
          title: 'SYNTHETIC denied task',
          instructions: 'SYNTHETIC denied instructions',
          scope: {
            mode: 'ghana_corpus',
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    const after = await w.run(w.orgA, (tx) => pgAiTaskStore.listTasks(tx));

    expect(after).toHaveLength(before.length);
  });

  it('requires current Firm Knowledge read permissions for Firm Knowledge scope', async () => {
    await expect(
      w.run(w.orgA, (tx) =>
        createAiTask(dependencies(), tx, orgAContext(['ai_task:create']), {
          employeeType: 'matter_manager',
          title: 'SYNTHETIC Firm Knowledge permission check',
          instructions: 'SYNTHETIC permission check',
          scope: {
            mode: 'ghana_corpus_and_firm_knowledge',
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });
  });

  it('requires matter:read and refuses a matter hidden by tenant isolation', async () => {
    await expect(
      w.run(w.orgA, (tx) =>
        createAiTask(dependencies(), tx, orgAContext(['ai_task:create']), {
          employeeType: 'ai_paralegal',
          title: 'SYNTHETIC missing matter permission',
          instructions: 'SYNTHETIC matter permission check',
          scope: {
            mode: 'ghana_corpus_and_matter',
            matterId: String(w.matterA.id),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    await expect(
      w.run(w.orgA, (tx) =>
        createAiTask(dependencies(), tx, orgAContext(['ai_task:create', 'matter:read']), {
          employeeType: 'ai_paralegal',
          title: 'SYNTHETIC cross-tenant matter',
          instructions: 'SYNTHETIC cross-tenant matter check',
          scope: {
            mode: 'ghana_corpus_and_matter',
            matterId: String(w.matterB.id),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ai_task.matter_not_found',
    });
  });

  it('does not reveal another tenant task through get or list', async () => {
    const task = await w.run(w.orgA, (tx) =>
      createAiTask(dependencies(), tx, fullContext(), {
        employeeType: 'research_associate',
        title: 'SYNTHETIC tenant-isolated task',
        instructions: 'SYNTHETIC tenant isolation',
        scope: {
          mode: 'ghana_corpus',
        },
      }),
    );

    await expect(
      w.run(w.orgB, (tx) => getAiTask(pgAiTaskStore, tx, orgBContext(['ai_task:read']), task.id)),
    ).rejects.toMatchObject({
      code: 'ai_task.not_found',
    });

    const listed = await w.run(w.orgB, (tx) =>
      listAiTasks(pgAiTaskStore, tx, orgBContext(['ai_task:read'])),
    );

    expect(listed.some((candidate) => candidate.id === task.id)).toBe(false);
  });

  it('supports draft update, scope revision, ready, cancellation and safe audit metadata', async () => {
    const privateInstructions =
      'SYNTHETIC PRIVATE INSTRUCTIONS MUST NEVER APPEAR IN AUDIT METADATA';

    const task = await w.run(w.orgA, (tx) =>
      createAiTask(dependencies(), tx, fullContext(), {
        employeeType: 'contract_analyst',
        title: 'SYNTHETIC lifecycle task',
        instructions: privateInstructions,
        scope: {
          mode: 'ghana_corpus',
        },
      }),
    );

    const updated = await w.run(w.orgA, (tx) =>
      updateAiTask(pgAiTaskStore, tx, fullContext(), {
        id: task.id,
        title: 'SYNTHETIC lifecycle task updated',
        instructions: privateInstructions,
      }),
    );

    expect(updated.title).toBe('SYNTHETIC lifecycle task updated');

    const revised = await w.run(w.orgA, (tx) =>
      reviseAiTaskScope(dependencies(), tx, fullContext(), {
        id: task.id,
        scope: {
          mode: 'ghana_corpus_and_matter',
          matterId: String(w.matterA.id),
        },
      }),
    );

    expect(revised.currentScopeRevision).toBe(2);
    expect(revised.scope.scopeMode).toBe('ghana_corpus_and_matter');

    const ready = await w.run(w.orgA, (tx) =>
      markAiTaskReady(dependencies(), tx, fullContext(), task.id),
    );

    expect(ready.status).toBe('ready');

    const cancelled = await w.run(w.orgA, (tx) =>
      cancelAiTask(pgAiTaskStore, tx, fullContext(), task.id),
    );

    expect(cancelled.status).toBe('cancelled');

    const history = await w.run(w.orgA, (tx) =>
      listAiTaskScopeRevisions(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
    );

    expect(history.map((scope) => scope.revision)).toEqual([1, 2]);

    const audit = await w.run(w.orgA, (tx) =>
      tx.query<{
        action: string;
        actor_kind: string;
        actor_id: string | null;
        metadata: Record<string, unknown>;
      }>(
        `SELECT
           action,
           actor_kind,
           actor_id,
           metadata
         FROM audit.events
         WHERE resource_type = 'ai_task'
           AND resource_id = $1`,
        [task.id],
      ),
    );

    expect(audit.rows.map((row) => row.action).sort()).toEqual(
      [
        'ai_task.cancelled',
        'ai_task.created',
        'ai_task.ready',
        'ai_task.scope_revised',
        'ai_task.updated',
      ].sort(),
    );

    expect(
      audit.rows.every((row) => row.actor_kind === 'user' && row.actor_id === String(w.userA)),
    ).toBe(true);

    expect(JSON.stringify(audit.rows.map((row) => row.metadata))).not.toContain(
      privateInstructions,
    );
  });

  it('reauthorizes Firm Knowledge permission before marking a task ready', async () => {
    const task = await w.run(w.orgA, (tx) =>
      createAiTask(dependencies(), tx, fullContext(), {
        employeeType: 'research_associate',
        title: 'SYNTHETIC ready reauthorization',
        instructions: 'SYNTHETIC ready reauthorization',
        scope: {
          mode: 'ghana_corpus_and_firm_knowledge',
        },
      }),
    );

    await expect(
      w.run(w.orgA, (tx) =>
        markAiTaskReady(dependencies(), tx, orgAContext(['ai_task:transition']), task.id),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    const persisted = await w.run(w.orgA, (tx) =>
      getAiTask(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
    );

    expect(persisted.status).toBe('draft');
  });

  it('reauthorizes the active Ghana entitlement before marking a task ready', async () => {
    const task = await w.run(w.orgA, (tx) =>
      createAiTask(dependencies(), tx, fullContext(), {
        employeeType: 'matter_manager',
        title: 'SYNTHETIC entitlement reauthorization',
        instructions: 'SYNTHETIC entitlement reauthorization',
        scope: {
          mode: 'ghana_corpus',
        },
      }),
    );

    await w.database.withAdmin((client) =>
      client.query(
        `UPDATE policy.organization_jurisdictions
         SET status = 'revoked',
             revoked_at = clock_timestamp(),
             revoked_by = NULL,
             updated_at = clock_timestamp()
         WHERE organization_id = $1
           AND jurisdiction_id = $2`,
        [w.orgA, w.gh],
      ),
    );

    try {
      await expect(
        w.run(w.orgA, (tx) => markAiTaskReady(dependencies(), tx, fullContext(), task.id)),
      ).rejects.toMatchObject({
        code: 'JURISDICTION_NOT_ENTITLED',
      });
    } finally {
      await w.database.withAdmin((client) =>
        client.query(
          `UPDATE policy.organization_jurisdictions
           SET status = 'active',
               granted_at = clock_timestamp(),
               granted_by = NULL,
               revoked_at = NULL,
               revoked_by = NULL,
               updated_at = clock_timestamp()
           WHERE organization_id = $1
             AND jurisdiction_id = $2`,
          [w.orgA, w.gh],
        ),
      );
    }

    const persisted = await w.run(w.orgA, (tx) =>
      getAiTask(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
    );

    expect(persisted.status).toBe('draft');
  });

  it('rolls back an AI task mutation when audit recording fails', async () => {
    const task = await w.run(w.orgA, (tx) =>
      createAiTask(dependencies(), tx, fullContext(), {
        employeeType: 'research_associate',
        title: 'SYNTHETIC audit rollback baseline',
        instructions: 'SYNTHETIC audit rollback',
        scope: {
          mode: 'ghana_corpus',
        },
      }),
    );

    const invalidAuditActorContext = {
      principal: {
        kind: 'user',
        userId: 'x'.repeat(129),
      },
      organizationId: w.orgA,
      permissions: new Set(['ai_task:update']),
      roles: [],
    } as unknown as AuthzContext;

    await expect(
      w.run(w.orgA, (tx) =>
        updateAiTask(pgAiTaskStore, tx, invalidAuditActorContext, {
          id: task.id,
          title: 'THIS UPDATE MUST ROLL BACK',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'audit.invalid_event',
    });

    const persisted = await w.run(w.orgA, (tx) =>
      getAiTask(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
    );

    expect(persisted.title).toBe('SYNTHETIC audit rollback baseline');
  });

  it('serializes concurrent scope revisions without losing history', async () => {
    const task = await w.run(w.orgA, (tx) =>
      createAiTask(dependencies(), tx, fullContext(), {
        employeeType: 'ai_paralegal',
        title: 'SYNTHETIC concurrent scope revisions',
        instructions: 'SYNTHETIC concurrent scope revisions',
        scope: {
          mode: 'ghana_corpus',
        },
      }),
    );

    await Promise.all([
      w.run(w.orgA, (tx) =>
        reviseAiTaskScope(dependencies(), tx, fullContext(), {
          id: task.id,
          scope: {
            mode: 'ghana_corpus_and_firm_knowledge',
          },
        }),
      ),
      w.run(w.orgA, (tx) =>
        reviseAiTaskScope(dependencies(), tx, fullContext(), {
          id: task.id,
          scope: {
            mode: 'ghana_corpus_and_matter',
            matterId: String(w.matterA.id),
          },
        }),
      ),
    ]);

    const current = await w.run(w.orgA, (tx) =>
      getAiTask(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
    );

    const history = await w.run(w.orgA, (tx) =>
      listAiTaskScopeRevisions(pgAiTaskStore, tx, orgAContext(['ai_task:read']), task.id),
    );

    expect(current.currentScopeRevision).toBe(3);
    expect(history.map((scope) => scope.revision)).toEqual([1, 2, 3]);

    expect(new Set(history.slice(1).map((scope) => scope.scopeMode))).toEqual(
      new Set(['ghana_corpus_and_firm_knowledge', 'ghana_corpus_and_matter']),
    );
  });
});
