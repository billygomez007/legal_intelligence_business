import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import {
  retrieveLegalEvidence,
  type AuthorizedRetrievalScope,
  type RetrievalSourcePort,
} from '../src/index.js';

const scope: AuthorizedRetrievalScope = {
  organizationId: 'org-A',
  taskId: 'task-A',
  taskScopeRevision: 1,
  jurisdictionId:
    '00000000-0000-4000-8000-000000000001',
  countryCode: 'GH',
  matterId: null,
  scopeMode: 'ghana_corpus',
};

it('passes the authorized scope into each source adapter', async () => {
  const seen: AuthorizedRetrievalScope[] = [];

  const source: RetrievalSourcePort = {
    kind: 'corpus_document_version',

    async search(
      actualScope,
    ) {
      seen.push(actualScope);
      return [];
    },
  };

  const result =
    await retrieveLegalEvidence({
      scope,
      query: 'contract law',
      sources: [source],
    });

  assert.deepEqual(
    seen,
    [scope],
  );

  assert.deepEqual(
    result.evidence,
    [],
  );
});

it('allows a valid empty retrieval result', async () => {
  const result =
    await retrieveLegalEvidence({
      scope,
      query: 'something unavailable',
      sources: [],
    });

  assert.equal(
    result.evidence.length,
    0,
  );
});

it('rejects non-Ghana scope', async () => {
  await assert.rejects(
    retrieveLegalEvidence({
      scope: {
        ...scope,
        countryCode:
          'NG' as 'GH',
      },
      query: 'law',
      sources: [],
    }),
    /retrieval\.jurisdiction_not_supported/,
  );
});

it('rejects invalid task scope revision', async () => {
  await assert.rejects(
    retrieveLegalEvidence({
      scope: {
        ...scope,
        taskScopeRevision: 0,
      },
      query: 'law',
      sources: [],
    }),
    /retrieval\.task_scope_revision_invalid/,
  );
});
