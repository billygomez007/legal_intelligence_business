import { strict as assert } from 'node:assert';
import { it } from 'vitest';

import {
  buildGroundedResearchPacket,
  type AuthorizedRetrievalScope,
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

it('marks an empty evidence packet as insufficient', () => {
  const packet =
    buildGroundedResearchPacket({
      question:
        'What is the governing law?',
      scope,
      evidence: [],
    });

  assert.equal(
    packet.insufficientEvidence,
    true,
  );

  assert.equal(
    packet.evidence.length,
    0,
  );
});

it('preserves unresolved issues explicitly', () => {
  const packet =
    buildGroundedResearchPacket({
      question: 'Question',
      scope,
      evidence: [],
      unresolvedIssues: [
        'No published authority found',
      ],
    });

  assert.deepEqual(
    packet.unresolvedIssues,
    [
      'No published authority found',
    ],
  );
});
