/* eslint-disable @typescript-eslint/require-await -- Async test doubles intentionally implement the port contracts without I/O. */
import { strict as assert } from 'node:assert';
import { it } from 'vitest';
import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';
import { KnowledgeSourceId, KnowledgeSourceVersionId } from '@legalintel/knowledge';
import { MatterDocumentId, MatterDocumentVersionId } from '@legalintel/matter-documents';
import {
  createPrivateWorkProductSourceReader,
  type PrivateWorkProductSourceDependencies,
  type WorkProductSourceReference,
  type WorkProductTaskScopeAccess,
} from '../src/index.js';

type Task = NonNullable<Awaited<ReturnType<WorkProductTaskScopeAccess['findTask']>>>;
type Human = Extract<AuthzContext['principal'], { kind: 'user' }>;
type PrivateKind = 'knowledge_source_version' | 'matter_document_version';
type Deps = PrivateWorkProductSourceDependencies;
const SOURCE = '00000000-0000-4000-8000-000000000001';
const VERSION = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const permissions = [
  'work_product:read',
  'ai_task:read',
  'matter:read',
  'knowledge:source:read',
  'knowledge:version:read',
  'matter-document:read',
  'matter-document:version:read',
];
const context: AuthzContext = {
  principal: { kind: 'user', userId: 'user-A' as Human['userId'] },
  organizationId: 'org-A' as NonNullable<AuthzContext['organizationId']>,
  roles: ['owner'],
  permissions: new Set(permissions),
};

function harness(kind: PrivateKind = 'knowledge_source_version') {
  // Deliberately projected metadata fixtures; no real database is used here.
  const h = {
    calls: [] as string[],
    error: '',
    permitted: true,
    mode: 'ghana_corpus_and_matter_and_firm_knowledge' as Task['scope']['scopeMode'],
    status: 'ready',
    revision: 1,
    parent: { id: SOURCE, organizationId: 'org-A', matterId: 'matter-A', status: 'active' },
    versions: [
      {
        id: OTHER,
        organizationId: 'org-A',
        sourceId: SOURCE,
        documentId: SOURCE,
        matterId: 'matter-A',
        versionNumber: 99,
      },
      {
        id: VERSION,
        organizationId: 'org-A',
        sourceId: SOURCE,
        documentId: SOURCE,
        matterId: 'matter-A',
        versionNumber: 1,
      },
    ],
    missingParent: false,
  };
  const tx = {
    async query() {
      h.calls.push('session');
      return { rows: [{ organization_id: 'org-A', user_id: 'user-A' }], rowCount: 1 };
    },
  } as unknown as Tx;
  const taskAccess: WorkProductTaskScopeAccess = {
    async findTask(actual, id) {
      assert.equal(actual, tx);
      assert.equal(id, 'task-A');
      h.calls.push('task');
      if (!h.permitted) return null;
      const matterId = h.mode.includes('and_matter') ? 'matter-A' : null;
      return {
        id,
        organizationId: 'org-A',
        status: h.status,
        currentScopeRevision: h.revision,
        scope: {
          organizationId: 'org-A',
          taskId: id,
          revision: h.revision,
          jurisdictionId: 'jurisdiction-GH',
          jurisdictionCode: 'GH',
          scopeMode: h.mode,
          matterId,
        },
      } as Task;
    },
    async authorizeGhana() {
      return 'jurisdiction-GH';
    },
    async findMatter() {
      return { id: 'matter-A', organizationId: 'org-A', jurisdictionId: 'jurisdiction-GH' };
    },
  };
  const parent = (actual: Tx, id: string, category: string) => {
    assert.equal(actual, tx);
    assert.equal(id, SOURCE);
    h.calls.push(category + '.parent');
    if (h.error === 'parent') throw new Error('parent unavailable');
    return h.missingParent ? null : { ...h.parent };
  };
  const versions = (actual: Tx, id: string, category: string) => {
    assert.equal(actual, tx);
    assert.equal(id, SOURCE);
    h.calls.push(category + '.versions');
    if (h.error === 'versions') throw new Error('versions unavailable');
    return h.versions.map((v) => ({
      ...v,
      originalFilename: 'fixture.txt',
      mimeType: 'text/plain',
      storageKey: 'test-only-key',
      contentSha256: 'a'.repeat(64),
      sizeBytes: 10,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }));
  };
  const dependencies: Deps = {
    taskAccess,
    knowledgeStore: {
      async findSource(t, id) {
        return parent(t, id, 'knowledge') as Awaited<
          ReturnType<Deps['knowledgeStore']['findSource']>
        >;
      },
      async listSourceVersions(t, id) {
        return versions(t, id, 'knowledge').map((v) => ({
          ...v,
          id: KnowledgeSourceVersionId.parse(v.id),
          sourceId: KnowledgeSourceId.parse(v.sourceId),
        }));
      },
    },
    matterDocumentStore: {
      async findDocument(t, id) {
        return parent(t, id, 'matter') as Awaited<
          ReturnType<Deps['matterDocumentStore']['findDocument']>
        >;
      },
      async listDocumentVersions(t, id) {
        return versions(t, id, 'matter').map((v) => ({
          ...v,
          id: MatterDocumentVersionId.parse(v.id),
          documentId: MatterDocumentId.parse(v.documentId),
        }));
      },
    },
  };
  const reader = createPrivateWorkProductSourceReader(tx, dependencies);
  const reference: WorkProductSourceReference = {
    kind,
    sourceId: SOURCE,
    versionId: VERSION,
    locator: null,
  };
  const scope = () => ({
    organizationId: 'org-A',
    taskId: 'task-A',
    taskScopeRevision: 1,
    matterId: h.mode.includes('and_matter') ? 'matter-A' : null,
    countryCode: 'GH',
    taskStatus: 'ready',
    permitted: true,
  });
  const run = () => reader.readSource(context, scope(), reference);
  return { h, reader, reference, scope, run };
}

for (const kind of ['knowledge_source_version', 'matter_document_version'] as const) {
  it(`authorizes the exact older ${kind} without exposing storage metadata`, async () => {
    const { run } = harness(kind);
    const result = await run();
    assert.deepEqual(result, {
      kind,
      sourceId: SOURCE,
      versionId: VERSION,
      organizationId: 'org-A',
      matterId: kind === 'matter_document_version' ? 'matter-A' : null,
      countryCode: kind === 'matter_document_version' ? 'GH' : null,
      permitted: true,
    });
    assert.ok(Object.isFrozen(result));
  });
  for (const patch of [{ status: 'archived' }, { organizationId: 'org-B' }, { id: OTHER }]) {
    it(`denies ${kind} parent ${JSON.stringify(patch)}`, async () => {
      const { h, run } = harness(kind);
      Object.assign(h.parent, patch);
      assert.equal(await run(), null);
      assert.ok(!h.calls.some((c) => c.endsWith('.versions')));
    });
  }
  it(`denies missing ${kind} parent`, async () => {
    const { h, run } = harness(kind);
    h.missingParent = true;
    assert.equal(await run(), null);
  });
  for (const patch of [
    { organizationId: 'org-B' },
    kind === 'knowledge_source_version' ? { sourceId: OTHER } : { documentId: OTHER },
  ]) {
    it(`denies mismatched ${kind} version ${JSON.stringify(patch)}`, async () => {
      const { h, run } = harness(kind);
      Object.assign(present(h.versions[1]), patch);
      assert.equal(await run(), null);
    });
  }
  it(`does not substitute the newest ${kind}`, async () => {
    const { h, run } = harness(kind);
    h.versions.pop();
    assert.equal(await run(), null);
  });
  it(`denies ambiguous duplicate ${kind} version IDs`, async () => {
    const { h, run } = harness(kind);
    h.versions.push({ ...present(h.versions[1]) });
    assert.equal(await run(), null);
  });
  for (const field of ['sourceId', 'versionId'] as const) {
    it(`denies malformed ${kind} ${field}`, async () => {
      const { h, reader, reference, scope } = harness(kind);
      assert.equal(
        await reader.readSource(context, scope(), { ...reference, [field]: 'invalid-id' }),
        null,
      );
      assert.ok(!h.calls.some((c) => c.endsWith('.parent')));
    });
  }
  for (const error of ['parent', 'versions']) {
    it(`propagates ${kind} ${error} failure`, async () => {
      const { h, run } = harness(kind);
      h.error = error;
      await assert.rejects(run(), /unavailable/);
    });
  }
  it(`reauthorizes ${kind} after the task is cancelled`, async () => {
    const { h, reader, scope, reference } = harness(kind);
    const old = scope();
    h.status = 'cancelled';
    assert.equal(await reader.readSource(context, old, reference), null);
  });
  it(`reauthorizes ${kind} after the task scope changes`, async () => {
    const { h, reader, scope, reference } = harness(kind);
    const old = scope();
    h.revision = 2;
    assert.equal(await reader.readSource(context, old, reference), null);
  });
  it(`denies inaccessible ${kind} task`, async () => {
    const { h, run } = harness(kind);
    h.permitted = false;
    assert.equal(await run(), null);
  });
  for (const mode of [
    'ghana_corpus',
    'ghana_corpus_and_firm_knowledge',
    'ghana_corpus_and_matter',
    'ghana_corpus_and_matter_and_firm_knowledge',
  ] as const) {
    it(`enforces ${mode} for ${kind}`, async () => {
      const { h, run } = harness(kind);
      h.mode = mode;
      const permitted =
        kind === 'knowledge_source_version'
          ? mode.includes('firm_knowledge')
          : mode.includes('and_matter');
      assert.equal((await run()) !== null, permitted);
    });
  }
}
for (const level of ['parent', 'version']) {
  it(`denies a matter document ${level} belonging to another matter`, async () => {
    const { h, run } = harness('matter_document_version');
    if (level === 'parent') h.parent.matterId = 'other';
    else present(h.versions[1]).matterId = 'other';
    assert.equal(await run(), null);
  });
}
for (const permission of permissions) {
  it(`requires ${permission} on a combined-scope matter source read`, async () => {
    const { reader, scope, reference } = harness('matter_document_version');
    await assert.rejects(
      reader.readSource(
        { ...context, permissions: new Set(permissions.filter((p) => p !== permission)) },
        scope(),
        reference,
      ),
    );
  });
}
for (const kind of ['api_key', 'system']) {
  it(`denies ${kind} source access even with supplied permissions`, async () => {
    const { h, reader, scope, reference } = harness();
    await assert.rejects(
      reader.readSource({ ...context, principal: { kind } } as AuthzContext, scope(), reference),
    );
    assert.deepEqual(h.calls, []);
  });
}
it('denies a supplied foreign organization before reading records', async () => {
  const { h, reader, scope, reference } = harness();
  await assert.rejects(
    reader.readSource(context, { ...scope(), organizationId: 'org-B' }, reference),
  );
  assert.deepEqual(h.calls, []);
});
it('denies a caller-supplied wrong matter', async () => {
  const { reader, scope, reference } = harness();
  assert.equal(
    await reader.readSource(context, { ...scope(), matterId: 'other' }, reference),
    null,
  );
});
it('blocks corpus references until a real corpus-rights reader exists', async () => {
  const { h, reader, scope, reference } = harness();
  assert.equal(
    await reader.readSource(context, scope(), { ...reference, kind: 'corpus_document_version' }),
    null,
  );
  assert.deepEqual(h.calls, []);
});
it('blocks unknown reference kinds', async () => {
  const { reader, scope, reference } = harness();
  assert.equal(
    await reader.readSource(context, scope(), {
      ...reference,
      kind: 'external_url',
    } as unknown as WorkProductSourceReference),
    null,
  );
});
it('copies reference identity before asynchronous store reads', async () => {
  const { reader, scope, reference } = harness();
  const mutable = { ...reference };
  const pending = reader.readSource(context, scope(), mutable);
  mutable.versionId = OTHER;
  assert.equal((await pending)?.versionId, VERSION);
});
it('delegates scope reads to the current task authorization reader', async () => {
  const { reader } = harness();
  assert.equal((await reader.readScope(context, 'task-A', 1))?.taskScopeRevision, 1);
});

function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
