/* eslint-disable @typescript-eslint/require-await -- Async test doubles intentionally implement the port contracts without I/O. */
import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import {
  appendPersistentWorkProductRevision,
  archivePersistentWorkProduct,
  createPersistentWorkProduct,
  recordPersistentWorkProductReview,
  submitPersistentWorkProductRevision,
  type StoredWorkProduct,
  type StoredWorkProductReview,
  type StoredWorkProductRevision,
  type WorkProductStore,
} from '../src/index.js';

type Human = Extract<AuthzContext['principal'], { kind: 'user' }>;

const USER = 'user-A';

const permissions = [
  'work_product:create',
  'work_product:read',
  'work_product:revise',
  'work_product:submit',
  'work_product:approve',
  'work_product:reject',
  'work_product:archive',
];

const context: AuthzContext = {
  principal: {
    kind: 'user',
    userId: USER as Human['userId'],
  },

  organizationId: 'org-A' as NonNullable<AuthzContext['organizationId']>,

  roles: ['owner'],
  permissions: new Set(permissions),
};

function product(patch: Partial<StoredWorkProduct> = {}): StoredWorkProduct {
  return {
    organizationId: 'org-A',
    id: 'wp-A',
    aiTaskId: 'task-A',
    matterId: 'matter-A',
    title: 'Advice note',
    kind: 'legal_note',
    status: 'draft',
    currentRevisionId: 'rev-A',
    submittedRevisionId: null,
    createdBy: USER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    ...patch,
  };
}

function revision(): StoredWorkProductRevision {
  return {
    organizationId: 'org-A',
    id: 'rev-A',
    workProductId: 'wp-A',
    revisionNumber: 1,
    taskScopeRevision: 2,
    previousRevisionId: null,
    content: 'Private content',
    contentFormat: 'plain_text',
    contentSha256: 'a'.repeat(64),
    revisionSha256: 'b'.repeat(64),
    createdBy: USER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function review(decision: 'approved' | 'rejected' = 'approved'): StoredWorkProductReview {
  return {
    organizationId: 'org-A',
    id: 'review-A',
    workProductId: 'wp-A',
    revisionId: 'rev-A',
    decision,
    reason: decision === 'rejected' ? 'Needs correction' : null,
    decidedBy: USER,
    decidedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function harness() {
  const state = {
    calls: [] as string[],
    auditValues: [] as unknown[][],
    createInput: null as unknown,
    revisionInput: null as unknown,
    reviewInput: null as unknown,
    submitResult: product({
      status: 'submitted',
      submittedRevisionId: 'rev-A',
    }) as StoredWorkProduct | null,
    reviewResult: review() as StoredWorkProductReview | null,
    archiveResult: product({
      status: 'archived',
      archivedAt: new Date('2026-01-02T00:00:00Z'),
    }) as StoredWorkProduct | null,
    failStore: false,
  };

  const tx = {
    async query(sql: string, values?: readonly unknown[]) {
      assert.match(sql, /INSERT INTO audit\.events/);

      state.calls.push('audit');
      state.auditValues.push([...(values ?? [])]);

      return {
        rows: [],
        rowCount: 1,
      };
    },
  } as unknown as Tx;

  const store: WorkProductStore<Tx> = {
    async createWorkProduct(actualTx, input) {
      assert.equal(actualTx, tx);

      if (state.failStore) {
        throw new Error('store failed');
      }

      state.calls.push('create');
      state.createInput = input;

      return product({
        createdBy: input.createdBy,
      });
    },

    async findWorkProduct() {
      return product();
    },

    async listRevisions() {
      return [revision()];
    },

    async appendRevision(actualTx, input) {
      assert.equal(actualTx, tx);

      if (state.failStore) {
        throw new Error('store failed');
      }

      state.calls.push('revision');
      state.revisionInput = input;

      return {
        ...revision(),
        createdBy: input.createdBy,
      };
    },

    async submitRevision(actualTx, productId, revisionId) {
      assert.equal(actualTx, tx);
      assert.equal(productId, 'wp-A');
      assert.equal(revisionId, 'rev-A');

      if (state.failStore) {
        throw new Error('store failed');
      }

      state.calls.push('submit');
      return state.submitResult;
    },

    async recordReview(actualTx, input) {
      assert.equal(actualTx, tx);

      if (state.failStore) {
        throw new Error('store failed');
      }

      state.calls.push('review');
      state.reviewInput = input;

      return state.reviewResult;
    },

    async archiveWorkProduct(actualTx, productId) {
      assert.equal(actualTx, tx);
      assert.equal(productId, 'wp-A');

      if (state.failStore) {
        throw new Error('store failed');
      }

      state.calls.push('archive');
      return state.archiveResult;
    },
  };

  return {
    state,
    tx,
    store,
  };
}

function withoutPermission(permission: string): AuthzContext {
  return {
    ...context,
    permissions: new Set(permissions.filter((item) => item !== permission)),
  };
}

it('creates as the authenticated human and audits after persistence', async () => {
  const { state, tx, store } = harness();

  await createPersistentWorkProduct(store, tx, context, {
    id: 'wp-A',
    aiTaskId: 'task-A',
    matterId: 'matter-A',
    title: 'Advice note',
    kind: 'legal_note',
  });

  assert.equal(
    (
      state.createInput as {
        createdBy: string;
      }
    ).createdBy,
    USER,
  );

  assert.deepEqual(state.calls, ['create', 'audit']);
});

it('persists a revision as the authenticated actor and audits only metadata', async () => {
  const { state, tx, store } = harness();

  await appendPersistentWorkProductRevision(store, tx, context, {
    id: 'rev-A',
    workProductId: 'wp-A',
    taskScopeRevision: 2,
    content: 'Secret legal work',
    contentFormat: 'plain_text',
    contentSha256: 'a'.repeat(64),
    revisionSha256: 'b'.repeat(64),
    provenance: [],
  });

  assert.equal(
    (
      state.revisionInput as {
        createdBy: string;
      }
    ).createdBy,
    USER,
  );

  const serialized = JSON.stringify(state.auditValues);

  assert.doesNotMatch(serialized, /Secret legal work/);

  assert.deepEqual(state.calls, ['revision', 'audit']);
});

it('submits then audits in the same transaction', async () => {
  const { state, tx, store } = harness();

  const result = await submitPersistentWorkProductRevision(store, tx, context, 'wp-A', 'rev-A');

  assert.equal(result?.status, 'submitted');

  assert.deepEqual(state.calls, ['submit', 'audit']);
});

it('does not audit a failed submission transition', async () => {
  const { state, tx, store } = harness();

  state.submitResult = null;

  assert.equal(
    await submitPersistentWorkProductRevision(store, tx, context, 'wp-A', 'rev-A'),
    null,
  );

  assert.deepEqual(state.calls, ['submit']);
});

for (const decision of ['approved', 'rejected'] as const) {
  it(`records ${decision} with authenticated reviewer identity`, async () => {
    const { state, tx, store } = harness();

    state.reviewResult = review(decision);

    await recordPersistentWorkProductReview(store, tx, context, {
      id: 'review-A',
      workProductId: 'wp-A',
      revisionId: 'rev-A',
      decision,
      reason: decision === 'rejected' ? 'Needs correction' : null,
    });

    assert.equal(
      (
        state.reviewInput as {
          decidedBy: string;
        }
      ).decidedBy,
      USER,
    );

    assert.deepEqual(state.calls, ['review', 'audit']);

    const serialized = JSON.stringify(state.auditValues);

    assert.doesNotMatch(serialized, /Needs correction/);
  });
}

it('does not audit when the review transition is rejected by persistence', async () => {
  const { state, tx, store } = harness();

  state.reviewResult = null;

  assert.equal(
    await recordPersistentWorkProductReview(store, tx, context, {
      id: 'review-A',
      workProductId: 'wp-A',
      revisionId: 'rev-A',
      decision: 'approved',
      reason: null,
    }),
    null,
  );

  assert.deepEqual(state.calls, ['review']);
});

it('archives then audits', async () => {
  const { state, tx, store } = harness();

  await archivePersistentWorkProduct(store, tx, context, 'wp-A');

  assert.deepEqual(state.calls, ['archive', 'audit']);
});

it('does not audit an already unavailable archive', async () => {
  const { state, tx, store } = harness();

  state.archiveResult = null;

  assert.equal(await archivePersistentWorkProduct(store, tx, context, 'wp-A'), null);

  assert.deepEqual(state.calls, ['archive']);
});

for (const [permission, operation] of [
  ['work_product:create', 'create'],
  ['work_product:revise', 'revise'],
  ['work_product:submit', 'submit'],
  ['work_product:approve', 'approve'],
  ['work_product:reject', 'reject'],
  ['work_product:archive', 'archive'],
] as const) {
  it(`requires ${permission}`, async () => {
    const { state, tx, store } = harness();

    const denied = withoutPermission(permission);

    const action = async () => {
      switch (operation) {
        case 'create':
          return createPersistentWorkProduct(store, tx, denied, {
            id: 'wp-A',
            aiTaskId: 'task-A',
            matterId: null,
            title: 'T',
            kind: 'note',
          });

        case 'revise':
          return appendPersistentWorkProductRevision(store, tx, denied, {
            id: 'rev-A',
            workProductId: 'wp-A',
            taskScopeRevision: 1,
            content: 'x',
            contentFormat: 'plain_text',
            contentSha256: 'a'.repeat(64),
            revisionSha256: 'b'.repeat(64),
            provenance: [],
          });

        case 'submit':
          return submitPersistentWorkProductRevision(store, tx, denied, 'wp-A', 'rev-A');

        case 'approve':
          return recordPersistentWorkProductReview(store, tx, denied, {
            id: 'review-A',
            workProductId: 'wp-A',
            revisionId: 'rev-A',
            decision: 'approved',
            reason: null,
          });

        case 'reject':
          return recordPersistentWorkProductReview(store, tx, denied, {
            id: 'review-A',
            workProductId: 'wp-A',
            revisionId: 'rev-A',
            decision: 'rejected',
            reason: 'Needs work',
          });

        case 'archive':
          return archivePersistentWorkProduct(store, tx, denied, 'wp-A');
      }
    };

    await assert.rejects(action());

    assert.deepEqual(state.calls, []);
  });
}

for (const kind of ['api_key', 'system'] as const) {
  it(`rejects ${kind} before persistence`, async () => {
    const { state, tx, store } = harness();

    await assert.rejects(
      createPersistentWorkProduct(
        store,
        tx,
        {
          ...context,
          principal: {
            kind,
          },
        } as AuthzContext,
        {
          id: 'wp-A',
          aiTaskId: 'task-A',
          matterId: null,
          title: 'T',
          kind: 'note',
        },
      ),
    );

    assert.deepEqual(state.calls, []);
  });
}

it('propagates persistence failure and writes no success audit', async () => {
  const { state, tx, store } = harness();

  state.failStore = true;

  await assert.rejects(
    createPersistentWorkProduct(store, tx, context, {
      id: 'wp-A',
      aiTaskId: 'task-A',
      matterId: null,
      title: 'T',
      kind: 'note',
    }),
    /store failed/,
  );

  assert.deepEqual(state.calls, []);
});
