/* eslint-disable @typescript-eslint/require-await -- Async test doubles intentionally implement the port contracts without I/O. */
import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import {
  createCorpusWorkProductSourceReader,
  type WorkProductTaskScopeAccess,
} from '../src/index.js';

type Human = Extract<AuthzContext['principal'], { kind: 'user' }>;

type Task = NonNullable<Awaited<ReturnType<WorkProductTaskScopeAccess['findTask']>>>;

const DOCUMENT = '00000000-0000-4000-8000-000000000101';

const VERSION = '00000000-0000-4000-8000-000000000102';

const JURISDICTION = '00000000-0000-4000-8000-000000000103';

const context: AuthzContext = {
  principal: {
    kind: 'user',
    userId: 'user-A' as Human['userId'],
  },

  organizationId: 'org-A' as NonNullable<AuthzContext['organizationId']>,

  roles: ['owner'],

  permissions: new Set(['work_product:read', 'ai_task:read']),
};

function fixture() {
  const state = {
    lifecycle: 'published',
    aiAllowed: true,
    returnedVersionId: VERSION,
    returnedDocumentId: DOCUMENT,
    returnedJurisdictionId: JURISDICTION,
    taskStatus: 'ready',
    scopeRevision: 1,
    rows: 1,
    calls: [] as string[],
  };

  const tx = {
    async query(sql: string, values?: readonly unknown[]) {
      if (sql.includes('app.current_org_id()')) {
        state.calls.push('session');

        return {
          rows: [
            {
              organization_id: 'org-A',
              user_id: 'user-A',
            },
          ],
          rowCount: 1,
        };
      }

      state.calls.push('corpus');

      assert.match(sql, /corpus\.source_allows/);

      assert.match(sql, /'ai_processing'/);

      assert.doesNotMatch(sql, /statement_timestamp/);

      assert.deepEqual(values, [VERSION, DOCUMENT, JURISDICTION]);

      const rows =
        state.rows === 1
          ? [
              {
                version_id: state.returnedVersionId,

                document_id: state.returnedDocumentId,

                jurisdiction_id: state.returnedJurisdictionId,

                lifecycle_state: state.lifecycle,

                ai_allowed: state.aiAllowed,
              },
            ]
          : [];

      return {
        rows,
        rowCount: rows.length,
      };
    },
  } as unknown as Tx;

  const taskAccess: WorkProductTaskScopeAccess = {
    async findTask() {
      state.calls.push('task');

      return {
        id: 'task-A',
        organizationId: 'org-A',
        requestedByUserId: 'user-A',
        employeeType: 'research_associate',
        title: 'Draft',
        instructions: 'Review',
        status: state.taskStatus as Task['status'],
        currentScopeRevision: state.scopeRevision,
        createdAt: new Date(),
        updatedAt: new Date(),

        scope: {
          organizationId: 'org-A',
          taskId: 'task-A',
          revision: state.scopeRevision,
          jurisdictionId: JURISDICTION,
          jurisdictionCode: 'GH',
          scopeMode: 'ghana_corpus',
          matterId: null,
          createdByUserId: 'user-A',
          createdAt: new Date(),
        },
      };
    },

    async authorizeGhana() {
      state.calls.push('entitlement');
      return JURISDICTION;
    },

    async findMatter() {
      return null;
    },
  };

  const reader = createCorpusWorkProductSourceReader(tx, taskAccess);

  const scope = {
    organizationId: 'org-A',
    taskId: 'task-A',
    taskScopeRevision: 1,
    matterId: null,
    countryCode: 'GH',
    taskStatus: 'ready',
    permitted: true,
  } as const;

  const reference = {
    kind: 'corpus_document_version',
    sourceId: DOCUMENT,
    versionId: VERSION,
    locator: null,
  } as const;

  return {
    state,
    reader,
    scope,
    reference,
  };
}

it('authorizes exact published Ghana corpus version with AI-processing rights', async () => {
  const { reader, scope, reference } = fixture();

  assert.deepEqual(await reader.readSource(context, scope, reference), {
    kind: 'corpus_document_version',
    sourceId: DOCUMENT,
    versionId: VERSION,
    organizationId: null,
    matterId: null,
    countryCode: 'GH',
    permitted: true,
  });
});

for (const lifecycle of ['ingesting', 'pending_review', 'approved', 'withdrawn', 'rejected']) {
  it(`denies corpus lifecycle ${lifecycle}`, async () => {
    const { state, reader, scope, reference } = fixture();

    state.lifecycle = lifecycle;

    assert.equal(await reader.readSource(context, scope, reference), null);
  });
}

it('denies when AI-processing rights are unavailable', async () => {
  const { state, reader, scope, reference } = fixture();

  state.aiAllowed = false;

  assert.equal(await reader.readSource(context, scope, reference), null);
});

it('requires exact immutable version identity', async () => {
  const { state, reader, scope, reference } = fixture();

  state.returnedVersionId = '00000000-0000-4000-8000-000000000999';

  assert.equal(await reader.readSource(context, scope, reference), null);
});

it('requires exact stable legal-document identity', async () => {
  const { state, reader, scope, reference } = fixture();

  state.returnedDocumentId = '00000000-0000-4000-8000-000000000998';

  assert.equal(await reader.readSource(context, scope, reference), null);
});

it('requires task Ghana jurisdiction', async () => {
  const { state, reader, scope, reference } = fixture();

  state.returnedJurisdictionId = '00000000-0000-4000-8000-000000000997';

  assert.equal(await reader.readSource(context, scope, reference), null);
});

it('denies missing corpus version', async () => {
  const { state, reader, scope, reference } = fixture();

  state.rows = 0;

  assert.equal(await reader.readSource(context, scope, reference), null);
});

it('reauthorizes current AI task before corpus access', async () => {
  const { state, reader, scope, reference } = fixture();

  state.taskStatus = 'cancelled';

  assert.equal(await reader.readSource(context, scope, reference), null);

  assert.equal(state.calls.includes('corpus'), false);
});

it('rejects stale AI task scope revision before corpus access', async () => {
  const { state, reader, scope, reference } = fixture();

  state.scopeRevision = 2;

  assert.equal(await reader.readSource(context, scope, reference), null);

  assert.equal(state.calls.includes('corpus'), false);
});

for (const field of ['sourceId', 'versionId'] as const) {
  it(`rejects malformed ${field}`, async () => {
    const { state, reader, scope, reference } = fixture();

    assert.equal(
      await reader.readSource(context, scope, {
        ...reference,
        [field]: 'bad-id',
      }),
      null,
    );

    assert.deepEqual(state.calls, []);
  });
}

it('does not process private source kinds', async () => {
  const { state, reader, scope, reference } = fixture();

  assert.equal(
    await reader.readSource(context, scope, {
      ...reference,
      kind: 'knowledge_source_version',
    }),
    null,
  );

  assert.deepEqual(state.calls, []);
});

for (const kind of ['api_key', 'system']) {
  it(`rejects ${kind} before database access`, async () => {
    const { state, reader, scope, reference } = fixture();

    await assert.rejects(
      reader.readSource(
        {
          ...context,
          principal: { kind },
        } as AuthzContext,
        scope,
        reference,
      ),
    );

    assert.deepEqual(state.calls, []);
  });
}
