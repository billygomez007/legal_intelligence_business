/* eslint-disable @typescript-eslint/require-await -- Async test doubles intentionally implement the port contracts without I/O. */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { it } from 'vitest';
import type { AuthzContext } from '@legalintel/iam';
import {
  MAX_WORK_PRODUCT_CONTENT_BYTES,
  prepareWorkProductContentRevision,
  reviewWorkProductRevision,
  submitReviewRevision,
  type WorkProductRevisionInput,
  type WorkProductRevisionSourceReader,
  type WorkProductScopeAuthorization,
  type WorkProductSourceAuthorization,
  type WorkProductSourceReference,
} from '../src/index.js';

type Human = Extract<AuthzContext['principal'], { kind: 'user' }>;
const context: AuthzContext = {
  principal: { kind: 'user', userId: 'author-1' as Human['userId'] },
  organizationId: 'org-A' as NonNullable<AuthzContext['organizationId']>,
  roles: ['owner'],
  permissions: new Set(['work_product:create', 'work_product:revise', 'work_product:approve']),
};
const ref: WorkProductSourceReference = {
  kind: 'knowledge_source_version',
  sourceId: 'source-1',
  versionId: 'version-1',
  locator: null,
};
function input(patch: Partial<WorkProductRevisionInput> = {}): WorkProductRevisionInput {
  return {
    id: 'revision-1',
    workProductId: 'product-1',
    organizationId: 'org-A',
    taskId: 'task-1',
    taskScopeRevision: 1,
    matterId: 'matter-1',
    content: 'Draft for human review.',
    format: 'plain_text',
    provenance: [ref],
    ...patch,
  };
}
function fixture(
  value = input(),
  scopePatch: Partial<WorkProductScopeAuthorization> = {},
  sourcePatch: Partial<WorkProductSourceAuthorization> = {},
): WorkProductRevisionSourceReader {
  return {
    async readScope() {
      return {
        organizationId: value.organizationId,
        taskId: value.taskId,
        taskScopeRevision: value.taskScopeRevision,
        matterId: value.matterId,
        countryCode: 'GH',
        taskStatus: 'ready',
        permitted: true,
        ...scopePatch,
      };
    },
    async readSource(_context, _scope, reference) {
      return {
        kind: reference.kind,
        sourceId: reference.sourceId,
        versionId: reference.versionId,
        organizationId: reference.kind === 'corpus_document_version' ? null : value.organizationId,
        matterId: reference.kind === 'matter_document_version' ? value.matterId : null,
        countryCode: reference.kind === 'corpus_document_version' ? 'GH' : null,
        permitted: true,
        ...sourcePatch,
      };
    },
  };
}
const prepare = (value = input(), reader = fixture(value)) =>
  prepareWorkProductContentRevision(reader, context, value);

it('builds a frozen initial draft with exact content checksum', async () => {
  const result = await prepare();
  assert.equal(result.state.status, 'draft');
  assert.equal(result.revision.number, 1);
  assert.equal(result.revision.previousRevisionId, null);
  assert.equal(result.revision.countryCode, 'GH');
  assert.equal(result.revision.authorUserId, 'author-1');
  assert.equal(
    result.revision.contentSha256,
    createHash('sha256').update(input().content, 'utf8').digest('hex'),
  );
  for (const item of [
    result,
    result.revision,
    result.revision.provenance,
    result.revision.provenance[0],
  ])
    assert.equal(Object.isFrozen(item), true);
});
it('produces deterministic revision fingerprints', async () => {
  assert.deepEqual(await prepare(), await prepare());
});
it('permits an explicitly empty source list without inventing citations', async () => {
  const result = await prepare(input({ provenance: [] }));
  assert.deepEqual(result.revision.provenance, []);
});
for (const kind of [
  'knowledge_source_version',
  'matter_document_version',
  'corpus_document_version',
] as const) {
  it(`checks a pinned ${kind}`, async () => {
    const value = input({ provenance: [{ ...ref, kind }] });
    const result = await prepare(value);
    assert.equal(result.revision.provenance[0]?.kind, kind);
  });
}
const invalidInputs: readonly [string, Record<string, unknown>][] = [
  ['empty content', { content: ' ' }],
  ['NUL content', { content: 'a\0b' }],
  ['ill-formed unicode', { content: '\ud800' }],
  ['unknown format', { format: 'html' }],
  ['missing product', { workProductId: '' }],
  ['missing task', { taskId: '' }],
  ['missing scope', { taskScopeRevision: 0 }],
  ['bad matter', { matterId: '' }],
  ['bad revision ID', { id: 'with spaces' }],
  ['missing provenance', { provenance: null }],
  ['unknown source kind', { provenance: [{ ...ref, kind: 'retrieval_result' }] }],
  ['missing source ID', { provenance: [{ ...ref, sourceId: '' }] }],
  ['missing version ID', { provenance: [{ ...ref, versionId: '' }] }],
  ['empty locator', { provenance: [{ ...ref, locator: '' }] }],
  ['oversized locator', { provenance: [{ ...ref, locator: 'x'.repeat(513) }] }],
  ['duplicate reference', { provenance: [ref, ref] }],
  ['too many references', { provenance: Array(101).fill(ref) }],
  ['sparse references', { provenance: Array(1) }],
  ['byte limit', { content: 'x'.repeat(MAX_WORK_PRODUCT_CONTENT_BYTES + 1) }],
  ['unicode byte limit', { content: '\u00e9'.repeat(MAX_WORK_PRODUCT_CONTENT_BYTES / 2 + 1) }],
];
for (const [name, patch] of invalidInputs) {
  it(`rejects ${name} before any source lookup`, async () => {
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
      prepareWorkProductContentRevision(reader, context, { ...input(), ...patch }),
    );
    assert.equal(calls, 0);
  });
}
for (const [name, patch] of [
  ['foreign organization', { organizationId: 'org-B' }],
  ['wrong task', { taskId: 'other' }],
  ['wrong scope', { taskScopeRevision: 2 }],
  ['wrong matter', { matterId: 'other' }],
  ['not Ghana', { countryCode: 'XX' }],
  ['draft task', { taskStatus: 'draft' }],
  ['cancelled task', { taskStatus: 'cancelled' }],
  ['scope access revoked', { permitted: false }],
] as const) {
  it(`denies ${name}`, async () => {
    await assert.rejects(prepare(input(), fixture(input(), patch)), {
      code: 'work_product.task_scope_unavailable',
    });
  });
}
for (const patch of [
  { permitted: false },
  { sourceId: 'other' },
  { versionId: 'other' },
  { kind: 'corpus_document_version' as const },
  { organizationId: 'org-B' },
  { countryCode: 'XX' },
  { matterId: 'other' },
]) {
  it(`denies bad source evidence ${JSON.stringify(patch)}`, async () => {
    await assert.rejects(prepare(input(), fixture(input(), {}, patch)), {
      code: 'work_product.source_unavailable',
    });
  });
}
it('denies missing scope', async () => {
  await assert.rejects(
    prepare(input(), {
      ...fixture(),
      async readScope() {
        return null;
      },
    }),
  );
});
it('denies missing source version', async () => {
  await assert.rejects(
    prepare(input(), {
      ...fixture(),
      async readSource() {
        return null;
      },
    }),
  );
});
it('propagates reader failure rather than fabricating source authorization', async () => {
  await assert.rejects(
    prepare(input(), {
      ...fixture(),
      async readSource() {
        throw new Error('reader unavailable');
      },
    }),
    /reader unavailable/,
  );
});
for (const countryCode of [null, 'XX']) {
  it(`denies corpus country ${countryCode}`, async () => {
    const value = input({ provenance: [{ ...ref, kind: 'corpus_document_version' }] });
    await assert.rejects(prepare(value, fixture(value, {}, { countryCode })));
  });
}
it('does not attach a matter document to a matterless product', async () => {
  const value = input({
    matterId: null,
    provenance: [{ ...ref, kind: 'matter_document_version' }],
  });
  await assert.rejects(prepare(value));
});
for (const denied of [
  { ...context, permissions: new Set<string>() },
  { ...context, organizationId: 'org-B' },
  { ...context, principal: { kind: 'api_key', createdBy: 'author-1' } },
  { ...context, principal: { kind: 'system' } },
]) {
  it(`denies untrusted access ${JSON.stringify(denied.principal)}`, async () => {
    let calls = 0;
    await assert.rejects(
      prepareWorkProductContentRevision(
        {
          ...fixture(),
          async readScope() {
            calls += 1;
            return null;
          },
        },
        denied as AuthzContext,
        input(),
      ),
      { code: 'authz.denied' },
    );
    assert.equal(calls, 0);
  });
}
it('copies input and references before awaiting source checks', async () => {
  const mutable = { ...input(), provenance: [{ ...ref }] };
  const pending = prepare(mutable);
  mutable.content = 'changed after call';
  present(mutable.provenance[0]).versionId = 'changed-after-call';
  const result = await pending;
  assert.equal(result.revision.content, input().content);
  assert.equal(result.revision.provenance[0]?.versionId, 'version-1');
});
for (const patch of [
  { content: 'Revised content.' },
  { format: 'markdown' as const },
  { taskScopeRevision: 2 },
  { provenance: [{ ...ref, locator: 'Page 2' }] },
]) {
  it(`advances an approved revision without inheriting approval ${JSON.stringify(patch)}`, async () => {
    const first = await prepare();
    const approved = reviewWorkProductRevision(
      context,
      'org-A',
      submitReviewRevision(first.state, 'revision-1'),
      'revision-1',
      {
        id: 'review-1',
        revisionId: 'revision-1',
        decision: 'approved',
        reason: null,
      },
    );
    const value = input({ id: 'revision-2', ...patch });
    const result = await prepareWorkProductContentRevision(fixture(value), context, value, {
      revision: first.revision,
      state: approved,
      expectedRevisionId: 'revision-1',
    });
    assert.equal(result.state.status, 'draft');
    assert.equal(result.state.reviews.length, 1);
    assert.equal(result.revision.number, 2);
    assert.equal(result.revision.previousRevisionId, 'revision-1');
    assert.notEqual(result.revision.revisionSha256, first.revision.revisionSha256);
    assert.equal(approved.status, 'approved');
  });
}
it('rejects a stale expected revision', async () => {
  const first = await prepare();
  await assert.rejects(
    prepareWorkProductContentRevision(fixture(), context, input({ id: 'revision-2' }), {
      ...first,
      expectedRevisionId: 'old',
    }),
    { code: 'work_product.stale_revision' },
  );
});
it('rejects a reused revision ID', async () => {
  const first = await prepare();
  await assert.rejects(
    prepareWorkProductContentRevision(fixture(), context, input(), {
      ...first,
      expectedRevisionId: 'revision-1',
    }),
    { code: 'work_product.revision_already_exists' },
  );
});
for (const patch of [
  { content: 'tampered' },
  { workProductId: 'other' },
  { contentSha256: '0'.repeat(64) },
  { number: 0 },
  { number: Number.MAX_SAFE_INTEGER },
]) {
  it(`rejects altered previous record ${JSON.stringify(patch)}`, async () => {
    const first = await prepare();
    await assert.rejects(
      prepareWorkProductContentRevision(fixture(), context, input({ id: 'revision-2' }), {
        ...first,
        expectedRevisionId: 'revision-1',
        revision: { ...first.revision, ...patch },
      }),
      { code: 'work_product.previous_revision_mismatch' },
    );
  });
}

function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
