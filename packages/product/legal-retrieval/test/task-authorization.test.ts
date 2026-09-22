import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import {
  type WorkProductTaskScopeAccess,
} from '@legalintel/work-products';

import {
  authorizeRetrievalScope,
} from '../src/index.js';

type Human = Extract<
  AuthzContext['principal'],
  { kind: 'user' }
>;

const JURISDICTION =
  '00000000-0000-4000-8000-000000000101';

const context: AuthzContext = {
  principal: {
    kind: 'user',
    userId:
      'user-A' as Human['userId'],
  },

  organizationId:
    'org-A' as NonNullable<
      AuthzContext['organizationId']
    >,

  roles: ['owner'],

  permissions: new Set([
    'work_product:read',
    'ai_task:read',
    'matter:read',
  ]),
};

function fixture() {
  const state = {
    taskStatus: 'ready',
    taskRevision: 3,
    countryCode: 'GH',
    matterId:
      'matter-A' as string | null,
  };

  const tx = {
    async query(
      sql: string,
    ) {
      if (
        sql.includes(
          'app.current_org_id()',
        )
      ) {
        return {
          rows: [{
            organization_id: 'org-A',
            user_id: 'user-A',
          }],
          rowCount: 1,
        };
      }

      throw new Error(
        'unexpected query',
      );
    },
  } as unknown as Tx;

  const access:
    WorkProductTaskScopeAccess = {
      async findTask() {
        return {
          id: 'task-A',
          organizationId:
            'org-A',
          requestedByUserId:
            'user-A',
          employeeType:
            'research_associate',
          title:
            'Research',
          instructions:
            'Research Ghana law',
          status:
            state.taskStatus as 'ready',
          currentScopeRevision:
            state.taskRevision,
          createdAt:
            new Date(),
          updatedAt:
            new Date(),

          scope: {
            organizationId:
              'org-A',
            taskId:
              'task-A',
            revision:
              state.taskRevision,
            jurisdictionId:
              JURISDICTION,
            jurisdictionCode:
              state.countryCode,
            scopeMode:
              state.matterId === null
                ? 'ghana_corpus'
                : 'ghana_corpus_and_matter',
            matterId:
              state.matterId,
            createdByUserId:
              'user-A',
            createdAt:
              new Date(),
          },
        } as never;
      },

      async authorizeGhana() {
        return JURISDICTION;
      },

      async findMatter() {
        if (
          state.matterId === null
        ) {
          return null;
        }

        return {
          id:
            state.matterId,
          organizationId:
            'org-A',
          jurisdictionId:
            JURISDICTION,
        } as never;
      },
    };

  return {
    state,
    tx,
    access,
  };
}

it(
  'maps current authorized Phase 7 task scope into retrieval scope',
  async () => {
    const {
      tx,
      access,
    } = fixture();

    const scope =
      await authorizeRetrievalScope(
        tx,
        context,
        'task-A',
        3,
        access,
      );

    assert.deepEqual(
      scope,
      {
        organizationId:
          'org-A',
        taskId:
          'task-A',
        taskScopeRevision:
          3,
        jurisdictionId:
          JURISDICTION,
        countryCode:
          'GH',
        matterId:
          'matter-A',
        scopeMode:
          'ghana_corpus_and_matter',
      },
    );
  },
);

it(
  'rejects stale task scope revision',
  async () => {
    const {
      tx,
      access,
    } = fixture();

    assert.equal(
      await authorizeRetrievalScope(
        tx,
        context,
        'task-A',
        2,
        access,
      ),
      null,
    );
  },
);

it(
  'rejects task that is no longer ready',
  async () => {
    const {
      state,
      tx,
      access,
    } = fixture();

    state.taskStatus =
      'cancelled';

    assert.equal(
      await authorizeRetrievalScope(
        tx,
        context,
        'task-A',
        3,
        access,
      ),
      null,
    );
  },
);

it(
  'rejects non-Ghana jurisdiction',
  async () => {
    const {
      state,
      tx,
      access,
    } = fixture();

    state.countryCode =
      'NG';

    assert.equal(
      await authorizeRetrievalScope(
        tx,
        context,
        'task-A',
        3,
        access,
      ),
      null,
    );
  },
);
