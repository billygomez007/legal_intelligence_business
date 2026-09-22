/* eslint-disable @typescript-eslint/require-await -- Async test doubles intentionally implement the port contracts without I/O. */
import { strict as assert } from 'node:assert';
import { it } from 'vitest';
import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import {
  prepareWorkProductContentRevision,
  readAuthorizedWorkProductTaskScope,
  type WorkProductRevisionSourceReader,
  type WorkProductTaskScopeAccess,
} from '../src/index.js';

type Task = NonNullable<Awaited<ReturnType<WorkProductTaskScopeAccess['findTask']>>>;

type Human = Extract<AuthzContext['principal'], { kind: 'user' }>;

const allPermissions = [
  'work_product:read',
  'work_product:create',
  'ai_task:read',
  'knowledge:source:read',
  'knowledge:version:read',
  'matter:read',
];

const context: AuthzContext = {
  principal: {
    kind: 'user',
    userId: 'user-A' as Human['userId'],
  },
  organizationId: 'org-A' as NonNullable<AuthzContext['organizationId']>,
  permissions: new Set(allPermissions),
  roles: ['owner'],
};

function task(): Task {
  const date = new Date('2026-01-01T00:00:00Z');

  return {
    id: 'task-A',
    organizationId: 'org-A',
    requestedByUserId: 'user-A',
    employeeType: 'research_associate',
    title: 'Draft',
    instructions: 'Human review',
    status: 'ready',
    currentScopeRevision: 1,
    createdAt: date,
    updatedAt: date,
    scope: {
      organizationId: 'org-A',
      taskId: 'task-A',
      revision: 1,
      jurisdictionId: 'jurisdiction-GH',
      jurisdictionCode: 'GH',
      scopeMode: 'ghana_corpus_and_matter_and_firm_knowledge',
      matterId: 'matter-A',
      createdByUserId: 'user-A',
      createdAt: date,
    },
  };
}

function harness() {
  const h = {
    task: task() as Task | null,

    session: [
      {
        organization_id: 'org-A',
        user_id: 'user-A',
      },
    ] as {
      organization_id: string | null;
      user_id: string | null;
    }[],

    matter: {
      id: 'matter-A',
      organizationId: 'org-A',
      jurisdictionId: 'jurisdiction-GH',
    } as Awaited<ReturnType<WorkProductTaskScopeAccess['findMatter']>>,

    jurisdiction: 'jurisdiction-GH',
    calls: [] as string[],
  };

  // Recording transaction fixture, never a real connection.
  const tx = {
    async query(sql: string) {
      assert.equal(
        sql,
        'SELECT app.current_org_id()::text AS organization_id, app.current_user_id()::text AS user_id',
      );

      h.calls.push('session');

      return {
        rows: h.session,
        rowCount: h.session.length,
      };
    },
  } as unknown as Tx;

  const access: WorkProductTaskScopeAccess = {
    async findTask(actualTx, id) {
      assert.equal(actualTx, tx);
      assert.equal(id, 'task-A');
      h.calls.push('task');
      return h.task;
    },

    async authorizeGhana(actualTx) {
      assert.equal(actualTx, tx);
      h.calls.push('entitlement');
      return h.jurisdiction;
    },

    async findMatter(actualTx, id) {
      assert.equal(actualTx, tx);
      assert.equal(id, 'matter-A');
      h.calls.push('matter');
      return h.matter;
    },
  };

  return {
    h,
    tx,
    access,
    run: (c = context, revision = 1) =>
      readAuthorizedWorkProductTaskScope(tx, c, 'task-A', revision, access),
  };
}

for (const mode of [
  'ghana_corpus',
  'ghana_corpus_and_firm_knowledge',
  'ghana_corpus_and_matter',
  'ghana_corpus_and_matter_and_firm_knowledge',
] as const) {
  it(`authorizes the existing scope mode ${mode}`, async () => {
    const { h, run } = harness();
    const hasMatter = mode.includes('and_matter');

    h.task = {
      ...task(),
      scope: {
        ...task().scope,
        scopeMode: mode,
        matterId: hasMatter ? 'matter-A' : null,
      },
    };

    const result = await run();

    assert.equal(result?.taskScopeRevision, 1);
    assert.equal(result.countryCode, 'GH');
    assert.equal(result.matterId, hasMatter ? 'matter-A' : null);
    assert.ok(Object.isFrozen(result));
    assert.equal(h.calls.includes('matter'), hasMatter);
    assert.ok(h.calls.includes('entitlement'));
  });
}

for (const change of [
  { id: 'task-B' },
  { organizationId: 'org-B' },
  { status: 'draft' },
  { status: 'cancelled' },
  { currentScopeRevision: 2 },
]) {
  it(`rejects task mismatch ${JSON.stringify(change)}`, async () => {
    const { h, run } = harness();

    h.task = { ...task(), ...change } as Task;

    assert.equal(await run(), null);
    assert.ok(!h.calls.includes('entitlement'));
  });
}

for (const change of [
  { organizationId: 'org-B' },
  { taskId: 'task-B' },
  { revision: 2 },
  { jurisdictionCode: 'XX' },
  { scopeMode: 'unknown' },
  { matterId: null },
]) {
  it(`rejects scope mismatch ${JSON.stringify(change)}`, async () => {
    const { h, run } = harness();

    h.task = {
      ...task(),
      scope: { ...task().scope, ...change },
    } as Task;

    assert.equal(await run(), null);
  });
}

for (const permission of [
  'work_product:read',
  'ai_task:read',
  'knowledge:source:read',
  'knowledge:version:read',
  'matter:read',
]) {
  it(`requires ${permission}`, async () => {
    const { run } = harness();

    await assert.rejects(
      run({
        ...context,
        permissions: new Set(allPermissions.filter((p) => p !== permission)),
      }),
    );
  });
}

for (const kind of ['api_key', 'system']) {
  it(`rejects ${kind} before querying the transaction`, async () => {
    const { h, run } = harness();

    await assert.rejects(
      run({
        ...context,
        principal: { kind },
      } as AuthzContext),
    );

    assert.deepEqual(h.calls, []);
  });
}

for (const change of [
  { organization_id: 'org-B' },
  { organization_id: null },
  { user_id: 'user-B' },
  { user_id: null },
]) {
  it(`rejects mismatched transaction ${JSON.stringify(change)}`, async () => {
    const { h, run } = harness();

    h.session = [
      {
        organization_id: 'org-A',
        user_id: 'user-A',
        ...change,
      },
    ];

    await assert.rejects(run(), { code: 'authz.denied' });
    assert.deepEqual(h.calls, ['session']);
  });
}

it('rejects a missing transaction identity row', async () => {
  const { h, run } = harness();
  h.session = [];
  await assert.rejects(run(), { code: 'authz.denied' });
});

it('returns null for an unavailable task', async () => {
  const { h, run } = harness();
  h.task = null;
  assert.equal(await run(), null);
});

it('rejects a stale requested scope revision', async () => {
  assert.equal(await harness().run(context, 2), null);
});

it('rejects the wrong entitled jurisdiction', async () => {
  const { h, run } = harness();
  h.jurisdiction = 'wrong';
  assert.equal(await run(), null);
});

it('propagates revoked entitlement instead of allowing access', async () => {
  const { tx, access } = harness();

  await assert.rejects(
    readAuthorizedWorkProductTaskScope(tx, context, 'task-A', 1, {
      ...access,
      async authorizeGhana() {
        throw new Error('revoked');
      },
    }),
    /revoked/,
  );
});

it('propagates a task-store failure', async () => {
  const { tx, access } = harness();

  await assert.rejects(
    readAuthorizedWorkProductTaskScope(tx, context, 'task-A', 1, {
      ...access,
      async findTask() {
        throw new Error('unavailable');
      },
    }),
    /unavailable/,
  );
});

for (const matter of [
  null,
  {
    id: 'wrong',
    organizationId: 'org-A',
    jurisdictionId: 'jurisdiction-GH',
  },
  {
    id: 'matter-A',
    organizationId: 'org-B',
    jurisdictionId: 'jurisdiction-GH',
  },
  {
    id: 'matter-A',
    organizationId: 'org-A',
    jurisdictionId: 'wrong',
  },
]) {
  it(`denies an unavailable or mismatched matter ${JSON.stringify(matter)}`, async () => {
    const { h, run } = harness();
    h.matter = matter;
    assert.equal(await run(), null);
  });
}

it('does not require private-scope permissions for a corpus-only task', async () => {
  const { h, run } = harness();

  h.task = {
    ...task(),
    scope: {
      ...task().scope,
      scopeMode: 'ghana_corpus',
      matterId: null,
    },
  };

  assert.ok(
    await run({
      ...context,
      permissions: new Set(['work_product:read', 'ai_task:read']),
    }),
  );
});

it('rejects an unexpected matter on a corpus-only task', async () => {
  const { h, run } = harness();

  h.task = {
    ...task(),
    scope: {
      ...task().scope,
      scopeMode: 'ghana_corpus',
    },
  };

  assert.equal(await run(), null);
});

for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
  it(`rejects invalid scope revision ${String(revision)}`, async () => {
    const { h, run } = harness();

    await assert.rejects(run(context, revision as number));

    assert.deepEqual(h.calls, []);
  });

  it(`rejects invalid content scope revision ${String(revision)} before a lookup`, async () => {
    let calls = 0;

    const reader: WorkProductRevisionSourceReader = {
      async readScope() {
        calls += 1;
        return null;
      },
      async readSource() {
        calls += 1;
        return null;
      },
    };

    await assert.rejects(
      prepareWorkProductContentRevision(reader, context, {
        id: 'r1',
        workProductId: 'w1',
        organizationId: 'org-A',
        taskId: 'task-A',
        taskScopeRevision: revision as number,
        matterId: null,
        content: 'Draft',
        format: 'plain_text',
        provenance: [],
      }),
      { code: 'work_product.invalid_task_scope_revision' },
    );

    assert.equal(calls, 0);
  });
}
