import {
  createPgTaskAuthorizedResearch,
  synthesizeAuthorizedTask,
  type LegalSynthesisProvider,
} from '@legalintel/legal-synthesis';

import { createHash, randomUUID } from 'node:crypto';

import {
  withTenantTransaction,
  withPublicTransaction,
  runMigrations,
  getMigrationStatus,
  REQUIRED_ROLES,
  type Tx,
} from '@legalintel/db';
import {
  createTestDatabase,
  createEmptyTestDatabase,
  type TestDatabase,
} from '@legalintel/db/testing';
import type { AuthzContext } from '@legalintel/iam';
import {
  PgKnowledgeStore,
  KnowledgeSourceId,
  KnowledgeSourceVersionId,
} from '@legalintel/knowledge';
import {
  PgMatterDocumentStore,
  MatterDocumentId,
  MatterDocumentVersionId,
} from '@legalintel/matter-documents';
import { corpusStore, fieldFingerprint, JurisdictionId, VersionId } from '@legalintel/legal-corpus';
import { attestForTests, verifyForApproval } from '@legalintel/legal-corpus/testing';
import { pgWorkspaceStore } from '@legalintel/workspace';
import {
  PgWorkProductStore,
  appendPersistentWorkProductRevision,
  archivePersistentWorkProduct,
  createPersistentWorkProduct,
  recordPersistentWorkProductReview,
  submitPersistentWorkProductRevision,
  workProductPermissionKeys,
  createWorkProductSourceReader,
  prepareWorkProductContentRevision,
  type StoredWorkProduct,
  type WorkProductSourceReference,
} from '@legalintel/work-products';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allMigrationSets } from '../src/sets';

type OrganizationId = NonNullable<AuthzContext['organizationId']>;
type UserId = Extract<AuthzContext['principal'], { kind: 'user' }>['userId'];
const orgA = randomUUID() as OrganizationId;
const orgB = randomUUID() as OrganizationId;
const userA = randomUUID() as UserId;
const userB = randomUUID() as UserId;
const gh = randomUUID();
const store = new PgWorkProductStore();
const knowledgeStore = new PgKnowledgeStore();
const matterDocumentStore = new PgMatterDocumentStore();
let knowledge: WorkProductSourceReference;
let database: TestDatabase;
let run: <T>(org: OrganizationId, fn: (tx: Tx) => Promise<T>) => Promise<T>;
const context = (org = orgA): AuthzContext => ({
  principal: { kind: 'user', userId: org === orgA ? userA : userB },
  organizationId: org,
  roles: ['owner'],
  permissions: new Set([
    ...workProductPermissionKeys,
    'ai_task:read',
    'knowledge:source:read',
    'knowledge:version:read',
    'matter:read',
    'matter-document:read',
    'matter-document:version:read',
  ]),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

beforeAll(async () => {
  database = await createTestDatabase({ migrationSets: allMigrationSets });
  const pool = database.poolFor('app', { max: 8 });
  run = (org, fn) =>
    withTenantTransaction(
      pool,
      {
        organizationId: org,
        userId: org === orgA ? userA : userB,
      },
      fn,
    );
  await database.withAdmin(async (c) => {
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ]) {
      await c.query('INSERT INTO iam.users(id,email,display_name) VALUES ($1,$2,$3)', [
        user,
        `${user}@example.test`,
        'SYNTHETIC Phase 7 actor',
      ]);
      await c.query("INSERT INTO iam.organizations(id,name,slug,kind) VALUES ($1,$2,$3,'firm')", [
        org,
        'SYNTHETIC Phase 7 firm',
        `phase7-${org}`,
      ]);
      await c.query('INSERT INTO iam.memberships(organization_id,user_id) VALUES ($1,$2)', [
        org,
        user,
      ]);
    }
    await c.query(
      "INSERT INTO corpus.jurisdictions(id,code,name,kind,is_synthetic) VALUES ($1,'GH','Ghana','country',false)",
      [gh],
    );
    for (const org of [orgA, orgB])
      await c.query(
        'INSERT INTO policy.organization_jurisdictions(id,organization_id,jurisdiction_id) VALUES ($1,$2,$3)',
        [randomUUID(), org, gh],
      );
  });
  knowledge = await knowledgeReference();
});
afterAll(async () => {
  // Setup failures still need safe teardown.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  await database?.dispose();
});

async function product(org = orgA, matterId: string | null = null) {
  return run(org, async (tx) => {
    const taskId = randomUUID();
    await tx.query(
      `INSERT INTO ai_tasks.tasks
      (organization_id,id,requested_by_user_id,employee_type,title,instructions)
      VALUES (app.current_org_id(),$1,$2,'research_associate','SYNTHETIC task','SYNTHETIC instructions')`,
      [taskId, org === orgA ? userA : userB],
    );
    await tx.query(
      `INSERT INTO ai_tasks.task_scope_revisions
      (organization_id,task_id,revision,jurisdiction_id,jurisdiction_code,scope_mode,matter_id,created_by_user_id)
      VALUES (app.current_org_id(),$1,1,$2,'GH',$3,$4,app.current_user_id())`,
      [
        taskId,
        gh,
        matterId === null
          ? 'ghana_corpus_and_firm_knowledge'
          : 'ghana_corpus_and_matter_and_firm_knowledge',
        matterId,
      ],
    );
    await tx.query("UPDATE ai_tasks.tasks SET status='ready' WHERE id=$1", [taskId]);
    return createPersistentWorkProduct(store, tx, context(org), {
      id: randomUUID(),
      aiTaskId: taskId,
      matterId,
      title: 'SYNTHETIC work product',
      kind: 'research_note',
    });
  });
}

function revisionInput(workProductId: string) {
  const id = randomUUID();
  const content = 'SYNTHETIC private work product content';
  return {
    id,
    workProductId,
    taskScopeRevision: 1,
    content,
    contentFormat: 'plain_text' as const,
    contentSha256: hash(content),
    revisionSha256: hash(id),
    provenance: [knowledge],
  };
}
const append = (id: string) =>
  run(orgA, (tx) => appendPersistentWorkProductRevision(store, tx, context(), revisionInput(id)));
const submit = (id: string, revision: string) =>
  run(orgA, (tx) => submitPersistentWorkProductRevision(store, tx, context(), id, revision));
const review = (
  id: string,
  revision: string,
  decision: 'approved' | 'rejected',
  reason: string | null = null,
) =>
  run(orgA, (tx) =>
    recordPersistentWorkProductReview(store, tx, context(), {
      id: randomUUID(),
      workProductId: id,
      revisionId: revision,
      decision,
      reason,
    }),
  );

async function knowledgeReference(org = orgA): Promise<WorkProductSourceReference> {
  return run(org, async (tx) => {
    const source = await knowledgeStore.createSource(tx, {
      id: KnowledgeSourceId.parse(randomUUID()),
      name: 'SYNTHETIC knowledge',
    });
    const version = await knowledgeStore.createSourceVersion(tx, {
      id: KnowledgeSourceVersionId.parse(randomUUID()),
      sourceId: source.id,
      originalFilename: 'synthetic.txt',
      mimeType: 'text/plain',
      storageKey: `synthetic/${randomUUID()}`,
      contentSha256: hash('SYNTHETIC private source'),
      sizeBytes: 24,
    });
    return {
      kind: 'knowledge_source_version',
      sourceId: source.id,
      versionId: version.id,
      locator: 'SYNTHETIC locator',
    };
  });
}

async function authorizedAppend(
  p: StoredWorkProduct,
  provenance: WorkProductSourceReference[],
  taskScopeRevision = 1,
) {
  return run(p.organizationId as OrganizationId, async (tx) => {
    const ctx = context(p.organizationId as OrganizationId);
    const reader = createWorkProductSourceReader(tx, { knowledgeStore, matterDocumentStore });
    const prepared = await prepareWorkProductContentRevision(reader, ctx, {
      id: randomUUID(),
      workProductId: p.id,
      organizationId: p.organizationId,
      taskId: p.aiTaskId,
      taskScopeRevision,
      matterId: p.matterId,
      content: 'SYNTHETIC private generated analysis',
      format: 'plain_text',
      provenance,
    });
    const r = prepared.revision;
    return appendPersistentWorkProductRevision(store, tx, ctx, {
      id: r.id,
      workProductId: p.id,
      taskScopeRevision: r.taskScopeRevision,
      content: r.content,
      contentFormat: r.format,
      contentSha256: r.contentSha256,
      revisionSha256: r.revisionSha256,
      provenance: r.provenance,
    });
  });
}

describe('Phase 7 durable Work Products acceptance', () => {
  it('applies the complete ordered migration chain to a fresh empty database', async () => {
    const empty = await createEmptyTestDatabase();
    try {
      expect(allMigrationSets.map((set) => set.name)).toEqual([
        'platform',
        'iam',
        'audit',
        'corpus',
        'entitlements',
        'workspace',
        'knowledge',
        'matter_documents',
        'ai_tasks',
        'work_products',
        'legal_retrieval',
        'ingestion',
      ]);
      const applied = await empty.withMigrator((c) =>
        runMigrations(c, { sets: allMigrationSets, requiredRoles: REQUIRED_ROLES }),
      );
      expect(applied.alreadyApplied).toBe(0);
      const status = await empty.withMigrator((c) => getMigrationStatus(c, allMigrationSets));
      expect(status.every((row) => row.state === 'applied')).toBe(true);
      expect(status.filter((row) => row.set === 'work_products').map((row) => row.version)).toEqual(
        [1, 2],
      );
      const tables = await empty.withAdmin((c) =>
        c.query<{ name: string }>(
          "SELECT tablename AS name FROM pg_tables WHERE schemaname='work_products' ORDER BY tablename",
        ),
      );
      expect(tables.rows.map((row) => row.name)).toEqual([
        'reviews',
        'revision_provenance',
        'revisions',
        'work_products',
      ]);
    } finally {
      await empty.dispose();
    }
  });

  it.each(['content', 'locator', 'reason'] as const)(
    'still rejects null bytes in %s after the forward constraint repair',
    async (field) => {
      const p = await product();
      if (field === 'reason') {
        const r = await append(p.id);
        await submit(p.id, r.id);
        await expect(review(p.id, r.id, 'rejected', 'SYNTHETIC\0invalid')).rejects.toThrow(
          'Work product persistence failed.',
        );
      } else {
        const input = revisionInput(p.id);
        const invalid =
          field === 'content'
            ? { ...input, content: 'SYNTHETIC\0invalid' }
            : { ...input, provenance: [{ ...knowledge, locator: 'SYNTHETIC\0invalid' }] };
        await expect(
          run(orgA, (tx) => appendPersistentWorkProductRevision(store, tx, context(), invalid)),
        ).rejects.toThrow('Work product persistence failed.');
        expect(await run(orgA, (tx) => store.listRevisions(tx, p.id))).toHaveLength(0);
      }
    },
  );

  it('persists content revisions with an exact immutable history and authenticated author', async () => {
    const p = await product();
    const first = await append(p.id);
    const second = await append(p.id);
    expect([first.revisionNumber, second.revisionNumber]).toEqual([1, 2]);
    expect(second.previousRevisionId).toBe(first.id);
    expect(first.createdBy).toBe(userA);
    expect((await run(orgA, (tx) => store.listRevisions(tx, p.id))).map((r) => r.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('serializes simultaneous revision allocation without gaps or broken predecessor links', async () => {
    const p = await product();
    const revisions = await Promise.all(Array.from({ length: 6 }, () => append(p.id)));
    revisions.sort((a, b) => a.revisionNumber - b.revisionNumber);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(revisions.map((r) => r.previousRevisionId)).toEqual([
      null,
      ...revisions.slice(0, -1).map((r) => r.id),
    ]);
  });

  it('preserves old approval and resets the current state when a revision is appended', async () => {
    const p = await product();
    const first = await append(p.id);
    await submit(p.id, first.id);
    const decision = await review(p.id, first.id, 'approved');
    expect(decision?.decidedBy).toBe(userA);
    const second = await append(p.id);
    const current = await run(orgA, (tx) => store.findWorkProduct(tx, p.id));
    expect(current?.status).toBe('draft');
    expect(current?.currentRevisionId).toBe(second.id);
    expect(current?.submittedRevisionId).toBeNull();
    expect(await review(p.id, first.id, 'approved')).toBeNull();
    expect(
      (
        await run(orgA, (tx) =>
          tx.query('SELECT id FROM work_products.reviews WHERE work_product_id=$1', [p.id]),
        )
      ).rowCount,
    ).toBe(1);
  });

  it('requires a rejection reason and a new revision before resubmission', async () => {
    const p = await product();
    const revision = await append(p.id);
    await submit(p.id, revision.id);
    await expect(review(p.id, revision.id, 'rejected')).rejects.toMatchObject({ code: '23514' });
    await review(p.id, revision.id, 'rejected', 'SYNTHETIC private rejection reason');
    expect(await submit(p.id, revision.id)).toBeNull();
    const next = await append(p.id);
    expect((await submit(p.id, next.id))?.status).toBe('submitted');
  });

  it('blocks mutation after archive', async () => {
    const p = await product();
    const revision = await append(p.id);
    await run(orgA, (tx) => archivePersistentWorkProduct(store, tx, context(), p.id));
    await expect(append(p.id)).rejects.toThrow('work_product.not_available');
    expect(await submit(p.id, revision.id)).toBeNull();
    expect(await review(p.id, revision.id, 'approved')).toBeNull();
  });

  it('hides all tenant-owned history from another tenant and denies spoofed inserts', async () => {
    const p = await product();
    const r = await append(p.id);
    await submit(p.id, r.id);
    await review(p.id, r.id, 'approved');
    for (const table of ['work_products', 'revisions', 'revision_provenance', 'reviews']) {
      expect(
        (
          await run(orgB, (tx) =>
            tx.query(`SELECT 1 FROM work_products.${table} WHERE organization_id=$1`, [orgA]),
          )
        ).rowCount,
      ).toBe(0);
    }
    expect(await run(orgB, (tx) => store.findWorkProduct(tx, p.id))).toBeNull();
    expect(
      (
        await run(orgB, (tx) =>
          tx.query('UPDATE work_products.work_products SET title=$2 WHERE id=$1', [
            p.id,
            'SYNTHETIC tamper',
          ]),
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      run(orgB, (tx) =>
        tx.query(
          `INSERT INTO work_products.work_products
      (organization_id,id,ai_task_id,title,kind,created_by) VALUES ($1,$2,$3,'SYNTHETIC','note',$4)`,
          [orgA, randomUUID(), p.aiTaskId, userB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each(['revisions', 'revision_provenance', 'reviews'])(
    'limits runtime %s privileges to SELECT and INSERT',
    async (table) => {
      const result = await database.withAdmin((c) =>
        c.query<{ role: string; privilege: string; allowed: boolean }>(
          `
      SELECT role, privilege, has_table_privilege(role,$1,privilege) AS allowed
      FROM unnest(ARRAY['legalintel_app','legalintel_ingest','legalintel_dataops']) role
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) privilege`,
          [`work_products.${table}`],
        ),
      );
      for (const row of result.rows)
        expect(row.allowed).toBe(
          row.role === 'legalintel_app' && ['SELECT', 'INSERT'].includes(row.privilege),
        );
    },
  );

  it('rolls back persistence when the transaction fails after its audit write', async () => {
    const p = await product();
    const input = revisionInput(p.id);
    await expect(
      run(orgA, async (tx) => {
        await appendPersistentWorkProductRevision(store, tx, context(), input);
        throw new Error('synthetic_rollback');
      }),
    ).rejects.toThrow('synthetic_rollback');
    expect(await run(orgA, (tx) => store.listRevisions(tx, p.id))).toHaveLength(0);
    expect(
      (
        await run(orgA, (tx) =>
          tx.query('SELECT 1 FROM audit.events WHERE resource_id=$1', [input.id]),
        )
      ).rowCount,
    ).toBe(0);
  });

  it('commits exactly revisions 1 and 2 from two independent transactions at a barrier', async () => {
    const p = await product();
    let arrived = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const race = () =>
      run(orgA, async (tx) => {
        if (++arrived === 2) release?.();
        await barrier;
        return appendPersistentWorkProductRevision(store, tx, context(), revisionInput(p.id));
      });
    const outcomes = await Promise.allSettled([race(), race()]);
    expect(outcomes.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const committed = await run(orgA, (tx) => store.listRevisions(tx, p.id));
    expect(committed.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(new Set(committed.map((r) => r.id)).size).toBe(2);
    expect((await run(orgA, (tx) => store.findWorkProduct(tx, p.id)))?.currentRevisionId).toBe(
      committed[1]?.id,
    );
  });

  it('completes three revisions and keeps all six audit action types free of content', async () => {
    const p = await product();
    const r1 = await append(p.id);
    await submit(p.id, r1.id);
    await review(p.id, r1.id, 'approved');
    const r2 = await append(p.id);
    expect((await run(orgA, (tx) => store.findWorkProduct(tx, p.id)))?.status).toBe('draft');
    await submit(p.id, r2.id);
    expect(await review(p.id, r1.id, 'approved')).toBeNull();
    await review(p.id, r2.id, 'rejected', 'SYNTHETIC private rejection reason');
    const r3 = await append(p.id);
    expect((await run(orgA, (tx) => store.findWorkProduct(tx, p.id)))?.status).toBe('draft');
    const ledger = await run(orgA, (tx) =>
      tx.query(
        'SELECT revision_id,decision FROM work_products.reviews WHERE work_product_id=$1 ORDER BY decided_at',
        [p.id],
      ),
    );
    expect(ledger.rows).toEqual([
      { revision_id: r1.id, decision: 'approved' },
      { revision_id: r2.id, decision: 'rejected' },
    ]);
    await run(orgA, (tx) => archivePersistentWorkProduct(store, tx, context(), p.id));
    const events = await run(orgA, (tx) =>
      tx.query<{ action: string; metadata: Record<string, unknown>; actor_id: string }>(
        'SELECT action,metadata,actor_id FROM audit.events WHERE resource_id=ANY($1::text[]) ORDER BY occurred_at,id',
        [[p.id, r1.id, r2.id, r3.id]],
      ),
    );
    expect(events.rows.map((e) => e.action)).toEqual([
      'work_product.created',
      'work_product.revision_created',
      'work_product.submitted',
      'work_product.approved',
      'work_product.revision_created',
      'work_product.submitted',
      'work_product.rejected',
      'work_product.revision_created',
      'work_product.archived',
    ]);
    const keys: Record<string, string[]> = {
      'work_product.created': ['ai_task_id', 'has_matter', 'kind'],
      'work_product.revision_created': [
        'work_product_id',
        'revision_number',
        'task_scope_revision',
        'provenance_count',
      ],
      'work_product.submitted': ['revision_id'],
      'work_product.approved': ['revision_id', 'decision'],
      'work_product.rejected': ['revision_id', 'decision'],
      'work_product.archived': [],
    };
    for (const event of events.rows) {
      expect(event.actor_id).toBe(userA);
      expect(Object.keys(event.metadata).sort()).toEqual(keys[event.action]?.sort());
      expect(JSON.stringify(event.metadata).includes('SYNTHETIC')).toBe(false);
    }
  });

  it.each(['revisions', 'revision_provenance', 'reviews'])(
    'rejects direct UPDATE and DELETE of populated %s history, even as owner',
    async (table) => {
      const p = await product();
      const r = await append(p.id);
      await submit(p.id, r.id);
      await review(p.id, r.id, 'approved');
      const selector = table === 'revisions' ? 'id' : 'revision_id';
      for (const operation of ['UPDATE', 'DELETE']) {
        const sql =
          operation === 'UPDATE'
            ? `UPDATE work_products.${table} SET organization_id=organization_id WHERE ${selector}=$1`
            : `DELETE FROM work_products.${table} WHERE ${selector}=$1`;
        await expect(run(orgA, (tx) => tx.query(sql, [r.id]))).rejects.toMatchObject({
          code: '42501',
        });
        await expect(database.withAdmin((c) => c.query(sql, [r.id]))).rejects.toMatchObject({
          code: '42501',
          hint: 'work_products.immutable_history',
        });
      }
    },
  );

  it.each(['current_revision_id', 'submitted_revision_id'])(
    'rejects cross-product and cross-tenant %s pointers',
    async (column) => {
      const p = await product();
      const other = await product();
      const ownRevision = await append(p.id);
      const otherRevision = await append(other.id);
      const foreign = await product(orgB);
      for (const [org, id, target] of [
        [orgA, p.id, otherRevision.id],
        [orgB, foreign.id, ownRevision.id],
      ] as const) {
        await expect(
          run(org, (tx) =>
            tx.query(`UPDATE work_products.work_products SET ${column}=$2 WHERE id=$1`, [
              id,
              target,
            ]),
          ),
        ).rejects.toMatchObject({ code: '23514' });
      }
    },
  );

  it('rejects cross-tenant task attachment and history inserts', async () => {
    const p = await product();
    const r = await append(p.id);
    await submit(p.id, r.id);
    const decision = await review(p.id, r.id, 'approved');
    await expect(
      run(orgB, (tx) =>
        createPersistentWorkProduct(store, tx, context(orgB), {
          id: randomUUID(),
          aiTaskId: p.aiTaskId,
          matterId: null,
          title: 'SYNTHETIC',
          kind: 'note',
        }),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      run(orgB, (tx) =>
        tx.query(
          `INSERT INTO work_products.revision_provenance
      (organization_id,revision_id,ordinal,source_kind,source_id,version_id,recorded_by)
      VALUES ($1,$2,1,'knowledge_source_version',$3,$4,$5)`,
          [orgA, r.id, knowledge.sourceId, knowledge.versionId, userB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      run(orgB, (tx) =>
        tx.query(
          `INSERT INTO work_products.reviews
      (organization_id,id,work_product_id,revision_id,decision,decided_by)
      VALUES ($1,$2,$3,$4,'approved',$5)`,
          [orgA, randomUUID(), p.id, r.id, userB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(decision).not.toBeNull();
  });

  it('keeps FORCE RLS and grants PUBLIC no explicit schema, table or function access', async () => {
    const tables = await database.withAdmin((c) =>
      c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='work_products' AND c.relkind='r'",
      ),
    );
    expect(tables.rows).toHaveLength(4);
    expect(tables.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    const publicGrants = await database.withAdmin((c) =>
      c.query(`
      SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='work_products' AND a.grantee=0
      UNION ALL SELECT a.grantee FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='work_products' AND a.grantee=0
      UNION ALL SELECT a.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='work_products' AND a.grantee=0`),
    );
    expect(publicGrants.rowCount).toBe(0);
    for (const role of ['legalintel_ingest', 'legalintel_dataops']) {
      expect(
        (
          await database.withAdmin((c) =>
            c.query<{ allowed: boolean }>(
              "SELECT has_schema_privilege($1,'work_products','USAGE') AS allowed",
              [role],
            ),
          )
        ).rows[0]?.allowed,
      ).toBe(false);
    }
  });

  it.each(['approved', 'rejected'] as const)(
    'requires a human IAM principal for %s and ignores impersonation fields',
    async (decision) => {
      const p = await product();
      const r = await append(p.id);
      await submit(p.id, r.id);
      const input = {
        id: randomUUID(),
        workProductId: p.id,
        revisionId: r.id,
        decision,
        reason: 'SYNTHETIC reason',
        decidedBy: userB,
      };
      for (const principal of [
        { kind: 'system', name: 'synthetic' },
        { kind: 'api_key', apiKeyId: randomUUID() },
      ]) {
        const denied = { ...context(), principal } as AuthzContext;
        await expect(
          run(orgA, (tx) => recordPersistentWorkProductReview(store, tx, denied, input)),
        ).rejects.toMatchObject({ code: 'authz.denied' });
      }
      const accepted = await run(orgA, (tx) =>
        recordPersistentWorkProductReview(store, tx, context(), input),
      );
      expect(accepted?.decidedBy).toBe(userA);
      expect(
        (
          await run(orgA, (tx) =>
            tx.query(
              "SELECT 1 FROM audit.events WHERE resource_id=$1 AND action IN ('work_product.approved','work_product.rejected')",
              [p.id],
            ),
          )
        ).rowCount,
      ).toBe(1);
    },
  );

  it('persists the exact authorized knowledge version after a newer version is added', async () => {
    const p = await product();
    const ref = await knowledgeReference();
    await run(orgA, (tx) =>
      knowledgeStore.createSourceVersion(tx, {
        id: KnowledgeSourceVersionId.parse(randomUUID()),
        sourceId: KnowledgeSourceId.parse(ref.sourceId),
        originalFilename: 'synthetic-new.txt',
        mimeType: 'text/plain',
        storageKey: `synthetic/${randomUUID()}`,
        contentSha256: hash('SYNTHETIC newer version'),
        sizeBytes: 23,
      }),
    );
    const revision = await authorizedAppend(p, [ref]);
    const references = await run(orgA, (tx) =>
      tx.query(
        'SELECT source_kind,source_id,version_id,locator FROM work_products.revision_provenance WHERE revision_id=$1',
        [revision.id],
      ),
    );
    expect(references.rows).toEqual([
      {
        source_kind: ref.kind,
        source_id: ref.sourceId,
        version_id: ref.versionId,
        locator: ref.locator,
      },
    ]);
  });

  it('rejects foreign, archived, mismatched and stale sources before any durable revision', async () => {
    const p = await product();
    const archived = await knowledgeReference();
    await run(orgA, (tx) =>
      knowledgeStore.setSourceStatus(tx, KnowledgeSourceId.parse(archived.sourceId), 'archived'),
    );
    const foreign = await knowledgeReference(orgB);
    for (const ref of [archived, foreign, { ...knowledge, versionId: randomUUID() }]) {
      await expect(authorizedAppend(p, [ref])).rejects.toMatchObject({
        code: 'work_product.source_unavailable',
      });
    }
    await expect(authorizedAppend(p, [knowledge], 2)).rejects.toMatchObject({
      code: 'work_product.task_scope_unavailable',
    });
    await run(orgA, (tx) =>
      tx.query("UPDATE ai_tasks.tasks SET status='cancelled' WHERE id=$1", [p.aiTaskId]),
    );
    await expect(authorizedAppend(p, [knowledge])).rejects.toMatchObject({
      code: 'work_product.task_scope_unavailable',
    });
    expect(await run(orgA, (tx) => store.listRevisions(tx, p.id))).toHaveLength(0);
    expect(
      (
        await run(orgA, (tx) =>
          tx.query(
            "SELECT 1 FROM audit.events WHERE action='work_product.revision_created' AND metadata->>'work_product_id'=$1",
            [p.id],
          ),
        )
      ).rowCount,
    ).toBe(0);
  });

  it('authorizes a Matter Document version only inside its exact matter boundary', async () => {
    const fixture = await run(orgA, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, { name: 'SYNTHETIC client' });
      const matter = await pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: JurisdictionId.parse(gh),
        name: 'SYNTHETIC matter',
      });
      const document = await matterDocumentStore.createDocument(tx, {
        id: MatterDocumentId.parse(randomUUID()),
        matterId: matter.id,
        name: 'SYNTHETIC document',
      });
      const version = await matterDocumentStore.createDocumentVersion(tx, {
        id: MatterDocumentVersionId.parse(randomUUID()),
        matterId: matter.id,
        documentId: document.id,
        originalFilename: 'synthetic.txt',
        mimeType: 'text/plain',
        storageKey: `synthetic/${randomUUID()}`,
        contentSha256: hash('SYNTHETIC matter content'),
        sizeBytes: 24,
      });
      return {
        matter,
        reference: {
          kind: 'matter_document_version' as const,
          sourceId: document.id,
          versionId: version.id,
          locator: null,
        },
      };
    });
    const p = await product(orgA, fixture.matter.id);
    const r = await authorizedAppend(p, [fixture.reference]);
    expect(
      (
        await run(orgA, (tx) =>
          tx.query(
            'SELECT version_id FROM work_products.revision_provenance WHERE revision_id=$1',
            [r.id],
          ),
        )
      ).rows[0]?.['version_id'],
    ).toBe(fixture.reference.versionId);
    const outside = await product();
    await expect(authorizedAppend(outside, [fixture.reference])).rejects.toMatchObject({
      code: 'work_product.source_unavailable',
    });
  });

  it('PHASE 9H PRIVATE EVIDENCE STALENESS ACCEPTANCE rejects previously valid Firm Knowledge and Matter Documents after archive', async () => {
    /**
     * ------------------------------------------------------------
     * FIRM KNOWLEDGE
     * ------------------------------------------------------------
     *
     * First prove this exact private source/version is currently valid.
     */
    const knowledgeReferenceBeforeArchive = await knowledgeReference();

    const knowledgeValidProduct = await product();

    const validKnowledgeRevision = await authorizedAppend(knowledgeValidProduct, [
      knowledgeReferenceBeforeArchive,
    ]);

    expect(validKnowledgeRevision.id).toBeTruthy();

    /**
     * Archive the source after it has already been proven valid.
     */
    await run(orgA, (tx) =>
      knowledgeStore.setSourceStatus(
        tx,
        KnowledgeSourceId.parse(knowledgeReferenceBeforeArchive.sourceId),
        'archived',
      ),
    );

    const knowledgeStaleProduct = await product();

    await expect(
      authorizedAppend(knowledgeStaleProduct, [knowledgeReferenceBeforeArchive]),
    ).rejects.toMatchObject({
      code: 'work_product.source_unavailable',
    });

    expect(await run(orgA, (tx) => store.listRevisions(tx, knowledgeStaleProduct.id))).toHaveLength(
      0,
    );

    const knowledgeFailureAudit = await run(orgA, (tx) =>
      tx.query<{
        readonly count: number;
      }>(
        `
                SELECT
                  count(*)::int AS count
                FROM audit.events
                WHERE action =
                  'work_product.revision_created'
                  AND metadata
                    ->> 'work_product_id'
                    = $1
              `,
        [knowledgeStaleProduct.id],
      ),
    );

    expect(knowledgeFailureAudit.rows[0]?.count).toBe(0);

    /**
     * ------------------------------------------------------------
     * MATTER DOCUMENT
     * ------------------------------------------------------------
     *
     * Build the same exact-matter fixture used by the accepted Phase 7
     * Matter Document boundary test.
     */
    const matterFixture = await run(orgA, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, {
        name: 'SYNTHETIC Phase 9H client',
      });

      const matter = await pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,

        jurisdictionId: JurisdictionId.parse(gh),

        name: 'SYNTHETIC Phase 9H matter',
      });

      const document = await matterDocumentStore.createDocument(tx, {
        id: MatterDocumentId.parse(randomUUID()),

        matterId: matter.id,

        name: 'SYNTHETIC Phase 9H document',
      });

      const version = await matterDocumentStore.createDocumentVersion(tx, {
        id: MatterDocumentVersionId.parse(randomUUID()),

        matterId: matter.id,

        documentId: document.id,

        originalFilename: 'phase9h-synthetic.txt',

        mimeType: 'text/plain',

        storageKey: `synthetic/${randomUUID()}`,

        contentSha256: hash('SYNTHETIC Phase 9H matter evidence'),

        sizeBytes: 35,
      });

      return {
        matter,

        document,

        reference: {
          kind: 'matter_document_version' as const,

          sourceId: document.id,

          versionId: version.id,

          locator: null,
        },
      };
    });

    /**
     * First prove the exact Matter Document is valid inside the correct
     * matter-scoped task.
     */
    const matterValidProduct = await product(orgA, matterFixture.matter.id);

    const validMatterRevision = await authorizedAppend(matterValidProduct, [
      matterFixture.reference,
    ]);

    expect(validMatterRevision.id).toBeTruthy();

    /**
     * Archive the Matter Document after it has already been accepted once.
     */
    await run(orgA, (tx) =>
      matterDocumentStore.setDocumentStatus(
        tx,
        MatterDocumentId.parse(matterFixture.document.id),
        'archived',
      ),
    );

    const matterStaleProduct = await product(orgA, matterFixture.matter.id);

    await expect(
      authorizedAppend(matterStaleProduct, [matterFixture.reference]),
    ).rejects.toMatchObject({
      code: 'work_product.source_unavailable',
    });

    expect(await run(orgA, (tx) => store.listRevisions(tx, matterStaleProduct.id))).toHaveLength(0);

    const matterFailureAudit = await run(orgA, (tx) =>
      tx.query<{
        readonly count: number;
      }>(
        `
                SELECT
                  count(*)::int AS count
                FROM audit.events
                WHERE action =
                  'work_product.revision_created'
                  AND metadata
                    ->> 'work_product_id'
                    = $1
              `,
        [matterStaleProduct.id],
      ),
    );

    expect(matterFailureAudit.rows[0]?.count).toBe(0);
  });

  it('accepts a published Ghana corpus version only while current AI-processing rights permit it', async () => {
    const dataops = database.poolFor('dataops');
    const ingest = database.poolFor('ingest');
    const jurisdictionId = JurisdictionId.parse(gh);
    const sourceId = await withPublicTransaction(dataops, async (tx) => {
      const source = await corpusStore.registerSource(tx, {
        jurisdictionId,
        name: 'SYNTHETIC Ghana test source',
        kind: 'institutional_repository',
        reference: 'synthetic://phase7',
      });
      await corpusStore.recordRightsDecision(tx, {
        sourceId: source,
        status: 'approved',
        allowedUses: ['display', 'index_search', 'ai_processing'],
        evidenceReference: 'SYNTHETIC rights evidence',
        decidedBy: userA,
      });
      return source;
    });
    const draft = await withPublicTransaction(ingest, async (tx) => {
      const documentId = await corpusStore.createDocument(tx, {
        jurisdictionId,
        documentType: 'case',
        title: 'SYNTHETIC software fixture — NOT REAL LAW',
      });
      const versionId = await corpusStore.createVersion(tx, {
        documentId,
        jurisdictionId,
        sourceId,
        versionNumber: 1,
        acquiredAt: new Date(),
        contentChecksum: Buffer.from(hash('SYNTHETIC source text — NOT REAL LAW'), 'hex'),
        storageKey: `synthetic/${randomUUID()}`,
        pipelineVersion: 'synthetic-phase7',
      });
      await corpusStore.addPassages(tx, versionId, [
        {
          ordinal: 0,
          locator: 'SYNTHETIC paragraph',
          text: 'SYNTHETIC source text — NOT REAL LAW',
          extractionConfidence: 1,
        },
      ]);
      await corpusStore.submitForReview(tx, versionId);
      return { documentId, versionId };
    });
    await attestForTests(
      (sql, params) =>
        database.withAdmin((c) => c.query(sql, params === undefined ? undefined : [...params])),
      draft.versionId,
    );
    await verifyForApproval({ dataops }, draft.versionId, userA);
    await withPublicTransaction(dataops, async (tx) => {
      await corpusStore.approveVersion(tx, draft.versionId, userA);
      await corpusStore.publishVersion(tx, draft.versionId, userB);
    });
    const reference: WorkProductSourceReference = {
      kind: 'corpus_document_version',
      sourceId: draft.documentId,
      versionId: draft.versionId,
      locator: 'SYNTHETIC paragraph',
    };
    const accepted = await authorizedAppend(await product(), [reference]);
    expect(
      (
        await run(orgA, (tx) =>
          tx.query(
            'SELECT source_id,version_id FROM work_products.revision_provenance WHERE revision_id=$1',
            [accepted.id],
          ),
        )
      ).rows,
    ).toEqual([{ source_id: draft.documentId, version_id: draft.versionId }]);
    await withPublicTransaction(dataops, (tx) =>
      corpusStore.recordRightsDecision(tx, {
        sourceId,
        status: 'approved',
        allowedUses: ['display', 'index_search'],
        evidenceReference: 'SYNTHETIC AI permission removed',
        decidedBy: userA,
      }),
    );
    const denied = await product();
    await expect(authorizedAppend(denied, [reference])).rejects.toMatchObject({
      code: 'work_product.source_unavailable',
    });
    expect(await run(orgA, (tx) => store.listRevisions(tx, denied.id))).toHaveLength(0);
    await withPublicTransaction(dataops, (tx) =>
      corpusStore.recordRightsDecision(tx, {
        sourceId,
        status: 'revoked',
        allowedUses: [],
        evidenceReference: 'SYNTHETIC revocation',
        decidedBy: userA,
      }),
    );
    await expect(authorizedAppend(denied, [reference])).rejects.toMatchObject({
      code: 'work_product.source_unavailable',
    });
  });

  it.each(['create', 'revision', 'submit', 'approve', 'reject', 'archive'] as const)(
    'rolls back both state and audit for %s',
    async (operation) => {
      const p = await product();
      const r = await append(p.id);
      if (operation === 'approve' || operation === 'reject') await submit(p.id, r.id);
      const counts = () =>
        run(orgA, async (tx) => {
          const result = [];
          for (const table of [
            'work_products.work_products',
            'work_products.revisions',
            'work_products.revision_provenance',
            'work_products.reviews',
            'audit.events',
          ]) {
            result.push(
              (await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]
                ?.n,
            );
          }
          const aggregate = await store.findWorkProduct(tx, p.id);
          return {
            counts: result,
            status: aggregate?.status,
            current: aggregate?.currentRevisionId,
            submitted: aggregate?.submittedRevisionId,
          };
        });
      const before = await counts();
      await expect(
        run(orgA, async (tx) => {
          switch (operation) {
            case 'create':
              await createPersistentWorkProduct(store, tx, context(), {
                id: randomUUID(),
                aiTaskId: p.aiTaskId,
                matterId: null,
                title: 'SYNTHETIC',
                kind: 'note',
              });
              break;
            case 'revision':
              await appendPersistentWorkProductRevision(store, tx, context(), revisionInput(p.id));
              break;
            case 'submit':
              await submitPersistentWorkProductRevision(store, tx, context(), p.id, r.id);
              break;
            case 'approve':
            case 'reject':
              await recordPersistentWorkProductReview(store, tx, context(), {
                id: randomUUID(),
                workProductId: p.id,
                revisionId: r.id,
                decision: operation === 'approve' ? 'approved' : 'rejected',
                reason: 'SYNTHETIC private reason',
              });
              break;
            case 'archive':
              await archivePersistentWorkProduct(store, tx, context(), p.id);
              break;
          }
          throw new Error('synthetic_rollback');
        }),
      ).rejects.toThrow('synthetic_rollback');
      expect(await counts()).toEqual(before);
    },
  );

  it('rolls back a revision and provenance if the actual PostgreSQL audit insert fails', async () => {
    const p = await product();
    const input = revisionInput(p.id);
    await expect(
      run(orgA, async (tx) => {
        const failingAuditTx: Tx = {
          query(sql, values) {
            if (sql.includes('INSERT INTO audit.events')) {
              const invalid = [...(values ?? [])];
              invalid[2] = 'synthetic invalid action';
              return tx.query(sql, invalid);
            }
            return tx.query(sql, values);
          },
        };
        await appendPersistentWorkProductRevision(store, failingAuditTx, context(), input);
      }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await run(orgA, (tx) => store.listRevisions(tx, p.id))).toHaveLength(0);
    expect(
      (
        await run(orgA, (tx) =>
          tx.query('SELECT 1 FROM work_products.revision_provenance WHERE revision_id=$1', [
            input.id,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await run(orgA, (tx) =>
          tx.query('SELECT 1 FROM audit.events WHERE resource_id=$1', [input.id]),
        )
      ).rowCount,
    ).toBe(0);
  });

  it('never exposes rejected-row content through a database error', async () => {
    const p = await product();
    const input = { ...revisionInput(p.id), contentFormat: 'unsupported' as 'plain_text' };
    const error = await run(orgA, (tx) =>
      appendPersistentWorkProductRevision(store, tx, context(), input),
    ).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: '23514', message: 'Work product persistence failed.' });
    expect(error).not.toHaveProperty('detail');
    expect(error).not.toHaveProperty('cause');
    expect(String(error).includes(input.content)).toBe(false);
    expect(JSON.stringify(error).includes(input.content)).toBe(false);
  });

  it('protects populated Organization B rows from Organization A, including direct history inserts', async () => {
    const p = await product(orgB);
    const ref = await knowledgeReference(orgB);
    const r = await run(orgB, (tx) =>
      appendPersistentWorkProductRevision(store, tx, context(orgB), {
        ...revisionInput(p.id),
        provenance: [ref],
      }),
    );
    await run(orgB, (tx) =>
      submitPersistentWorkProductRevision(store, tx, context(orgB), p.id, r.id),
    );
    await run(orgB, (tx) =>
      recordPersistentWorkProductReview(store, tx, context(orgB), {
        id: randomUUID(),
        workProductId: p.id,
        revisionId: r.id,
        decision: 'approved',
        reason: null,
      }),
    );
    for (const table of ['work_products', 'revisions', 'revision_provenance', 'reviews']) {
      expect(
        (
          await run(orgA, (tx) =>
            tx.query(`SELECT 1 FROM work_products.${table} WHERE organization_id=$1`, [orgB]),
          )
        ).rowCount,
      ).toBe(0);
    }
    expect(
      (
        await run(orgA, (tx) =>
          tx.query("UPDATE work_products.work_products SET title='SYNTHETIC tamper' WHERE id=$1", [
            p.id,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      run(orgA, (tx) =>
        tx.query(
          `INSERT INTO work_products.revisions
      (organization_id,id,work_product_id,revision_number,task_scope_revision,content,content_format,content_sha256,revision_sha256,created_by)
      VALUES ($1,$2,$3,2,1,'SYNTHETIC','plain_text',$4,$5,$6)`,
          [orgB, randomUUID(), p.id, hash('SYNTHETIC'), hash(randomUUID()), userA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

/**
 * PHASE 9D LIVE POSTGRES TASK TO SYNTHESIS ACCEPTANCE
 *
 * This test deliberately lives at the migration composition root because it
 * reuses the already-accepted Phase 7 disposable PostgreSQL fixture:
 *
 * - real organization and user;
 * - real current AI Task and immutable task scope;
 * - real Ghana jurisdiction;
 * - real runtime application role;
 * - full migration chain.
 *
 * The legal authority below is synthetic test data only.
 */
describe('Phase 9D live PostgreSQL task-authorized legal synthesis', () => {
  it('runs current AI Task -> authorized corpus retrieval -> grounded synthesis with exact application-owned citations', async () => {
    /**
     * product() is the existing Phase 7 fixture helper.
     *
     * With no Matter it creates a current READY AI Task whose server-owned
     * scope is ghana_corpus.
     */
    const p = await product(orgA, null);

    const publisherSourceId = randomUUID();

    const legalDocumentId = randomUUID();

    const versionId = randomUUID();

    const passageId = randomUUID();

    const courtId = randomUUID();

    const authorityText = [
      'SYNTHETIC Ghana legal authority.',
      'The equitable estoppel principle requires the court',
      'to assess representation, reliance and resulting prejudice.',
      'This sentence exists only for Phase 9D retrieval testing.',
    ].join(' ');

    /**
     * Arrange one synthetic published Ghana corpus authority.
     *
     * Admin fixture writes are allowed only because this is the disposable
     * test database. The actual request below runs through legalintel_app.
     */
    await database.withAdmin(async (admin) => {
      await admin.query(
        `
                INSERT INTO corpus.sources (
                  id,
                  jurisdiction_id,
                  name,
                  kind,
                  reference
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  'institutional_repository',
                  $4
                )
              `,
        [
          publisherSourceId,
          gh,
          `SYNTHETIC Phase 9D source ${publisherSourceId}`,
          'phase9d://synthetic-authority',
        ],
      );

      /**
       * Publishing requires current display + index_search rights.
       * Retrieval additionally requires ai_processing.
       */
      await admin.query(
        `
                INSERT INTO corpus.source_rights_decisions (
                  source_id,
                  status,
                  allowed_uses,
                  evidence_reference,
                  decided_by
                )
                VALUES (
                  $1,
                  'approved',
                  ARRAY[
                    'display',
                    'index_search',
                    'ai_processing'
                  ]::text[],
                  'SYNTHETIC Phase 9D rights fixture',
                  $2
                )
              `,
        [publisherSourceId, userA],
      );

      await admin.query(
        `
                INSERT INTO corpus.legal_documents (
                  id,
                  jurisdiction_id,
                  document_type,
                  title
                )
                VALUES (
                  $1,
                  $2,
                  'case',
                  $3
                )
              `,
        [legalDocumentId, gh, 'SYNTHETIC Phase 9D Ghana authority'],
      );

      /**
       * A case must carry its real publish-critical case metadata.
       *
       * Court and decision_date are structurally separate from the
       * legal_documents row and must exist before human verification.
       */
      await admin.query(
        `
                INSERT INTO corpus.courts (
                  id,
                  jurisdiction_id,
                  name,
                  level,
                  authority_rank
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  1,
                  1
                )
              `,
        [courtId, gh, `SYNTHETIC Phase 9D Court ${courtId}`],
      );

      await admin.query(
        `
                INSERT INTO corpus.case_details (
                  document_id,
                  jurisdiction_id,
                  court_id,
                  decision_date,
                  neutral_citation,
                  docket_number
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  DATE '2026-01-15',
                  'SYNTHETIC PHASE9D 1',
                  'PHASE9D-001'
                )
              `,
        [legalDocumentId, gh, courtId],
      );

      /**
       * Corpus versions must begin in ingesting state.
       */
      await admin.query(
        `
                INSERT INTO corpus.document_versions (
                  id,
                  document_id,
                  jurisdiction_id,
                  version_number,
                  source_id,
                  source_reference,
                  acquired_at,
                  content_checksum,
                  storage_key,
                  pipeline_version
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  1,
                  $4,
                  'phase9d synthetic source reference',
                  now(),
                  sha256(
                    convert_to(
                      $5,
                      'UTF8'
                    )
                  ),
                  $6,
                  'phase9d'
                )
              `,
        [versionId, legalDocumentId, gh, publisherSourceId, authorityText, `phase9d/${versionId}`],
      );

      /**
       * Passages are inserted while the version is ingesting.
       */
      await admin.query(
        `
                INSERT INTO corpus.passages (
                  id,
                  version_id,
                  ordinal,
                  locator,
                  text,
                  text_sha256,
                  extraction_confidence
                )
                VALUES (
                  $1,
                  $2,
                  0,
                  'paragraph:1',
                  $3,
                  sha256(
                    convert_to(
                      $3,
                      'UTF8'
                    )
                  ),
                  1.000
                )
              `,
        [passageId, versionId, authorityText],
      );

      /**
       * Follow the real corpus lifecycle.
       */
      await admin.query(
        `
                UPDATE corpus.document_versions
                SET lifecycle_state =
                  'pending_review'
                WHERE id = $1
              `,
        [versionId],
      );

      /**
       * Publish-critical metadata must be verified by a person.
       *
       * Do this through the real corpus store so the test uses exactly
       * the same value fingerprinting contract as ingestion review.
       */
      const dataopsPool = database.poolFor('dataops', {
        max: 1,
      });

      await withPublicTransaction(dataopsPool, async (tx) => {
        const version = VersionId.parse(versionId);

        const metadata = await corpusStore.criticalMetadata(tx, version);

        /**
         * Verify every publish-critical metadata field that currently
         * has a value.
         *
         * This mirrors the accepted corpus verifyAll() test helper.
         * Optional fields such as neutral_citation and docket_number
         * become mandatory-to-verify only when they are populated.
         */
        for (const row of metadata) {
          if (row.value === null) {
            continue;
          }

          await corpusStore.recordFieldVerification(tx, {
            versionId: version,

            field: row.field,

            status: 'verified',

            valueSha256: fieldFingerprint(row.field, row.value),

            evidenceReference: `SYNTHETIC Phase 9D human verification: ${row.field}`,

            verifiedBy: userA,
          });
        }
      });

      /**
       * Provenance attestation must exist before the version may be
       * approved or published.
       *
       * The attestation is bound to the immutable version facts:
       * source_id, content_checksum and pipeline_version.
       */
      await admin.query(
        `
                INSERT INTO corpus.version_provenance_attestations (
                  version_id,
                  source_id,
                  content_checksum,
                  pipeline_version,
                  attestation_type,
                  attestation_version,
                  evidence_reference,
                  system_identity
                )
                SELECT
                  id,
                  source_id,
                  content_checksum,
                  pipeline_version,
                  'ingestion_pipeline',
                  1,
                  'SYNTHETIC Phase 9D provenance fixture',
                  'phase9d-test'
                FROM corpus.document_versions
                WHERE id = $1
              `,
        [versionId],
      );

      /**
       * Approval is gated by the append-only human review ledger.
       *
       * The latest decision must be an approval by the same person
       * recorded as approved_by.
       */
      await admin.query(
        `
                INSERT INTO corpus.version_review_decisions (
                  version_id,
                  decision,
                  reason_code,
                  decided_by
                )
                VALUES (
                  $1,
                  'approve',
                  'phase9d_approved',
                  $2
                )
              `,
        [versionId, userA],
      );

      await admin.query(
        `
                UPDATE corpus.document_versions
                SET
                  lifecycle_state =
                    'approved',
                  approved_by =
                    $2
                WHERE id = $1
              `,
        [versionId, userA],
      );

      /**
       * Corpus publication uses a two-person rule:
       * the approver must not also be the publisher.
       *
       * userB is an existing synthetic test IAM user and is used only
       * as the distinct publication actor in this disposable fixture.
       */
      await admin.query(
        `
                UPDATE corpus.document_versions
                SET
                  lifecycle_state =
                    'published',
                  published_by =
                    $2
                WHERE id = $1
              `,
        [versionId, userB],
      );
    });

    const appPool = database.poolFor('app', {
      max: 2,
    });

    const research = createPgTaskAuthorizedResearch(appPool);

    let providerCalls = 0;

    const provider: LegalSynthesisProvider = {
      async synthesize(request) {
        providerCalls += 1;

        /**
         * The provider receives evidence, not free-form authority IDs.
         */
        expect(request.countryCode).toBe('GH');

        expect(request.evidence.length).toBeGreaterThan(0);

        const matching = request.evidence.find(
          (item) =>
            item.source.sourceId === legalDocumentId &&
            item.source.versionId === versionId &&
            item.passageId === passageId,
        );

        expect(matching).toBeDefined();

        expect(matching?.excerpt).toContain('equitable estoppel');

        /**
         * Provider references only the application-assigned ordinal.
         */
        return {
          summary:
            'The retrieved synthetic authority identifies representation, reliance and prejudice as relevant to the stated principle.',

          propositions: [
            {
              text: 'The retrieved authority identifies representation, reliance and prejudice as relevant considerations.',

              evidenceOrdinals: [matching?.ordinal ?? 0],
            },
          ],

          unresolvedIssues: [],

          insufficientEvidence: false,
        };
      },
    };

    const ctx = context(orgA);

    const result = await synthesizeAuthorizedTask(
      {
        research,
        provider,
      },
      {
        context: ctx,

        taskId: p.aiTaskId,

        question: 'What does Ghanaian law say about equitable estoppel?',

        limit: 10,
      },
    );

    expect(providerCalls).toBe(1);

    expect(result.insufficientEvidence).toBe(false);

    expect(result.propositions).toHaveLength(1);

    expect(result.citations).toHaveLength(1);

    /**
     * Citation identity is reconstructed by Law Afrique from retrieved
     * evidence. It is not accepted from provider output.
     */
    expect(result.citations[0]).toEqual({
      evidenceOrdinal: 0,

      sourceKind: 'corpus_document_version',

      sourceId: legalDocumentId,

      versionId,

      passageId,

      locator: 'paragraph:1',
    });

    expect(result.propositions[0]?.citations[0]).toEqual(result.citations[0]);

    /**
     * PHASE 9E RIGHTS REVOCATION ACCEPTANCE
     *
     * The authority was valid at the time of the first synthesis.
     *
     * Now append a newer rights decision that keeps display/search
     * permission but deliberately removes ai_processing.
     *
     * Rights history is append-only; we never mutate the earlier decision.
     */
    await database.withAdmin(async (admin) => {
      await admin.query(
        `
                INSERT INTO corpus.source_rights_decisions (
                  source_id,
                  status,
                  allowed_uses,
                  evidence_reference,
                  decided_by
                )
                VALUES (
                  $1,
                  'approved',
                  ARRAY[
                    'display',
                    'index_search'
                  ]::text[],
                  'SYNTHETIC Phase 9E remove AI processing permission',
                  $2
                )
              `,
        [publisherSourceId, userA],
      );
    });

    /**
     * The published authority still exists and remains display/search
     * eligible, but it is no longer legal for AI processing.
     *
     * The second request must therefore produce no authorized evidence.
     * synthesizeGroundedLegalResearch must NOT call the provider.
     */
    const providerCallsBeforeRevokedRequest = providerCalls;

    const afterAiRightsRemoval = await synthesizeAuthorizedTask(
      {
        research,
        provider,
      },
      {
        context: ctx,

        taskId: p.aiTaskId,

        question: 'equitable estoppel',

        limit: 10,
      },
    );

    expect(providerCalls).toBe(providerCallsBeforeRevokedRequest);

    expect(afterAiRightsRemoval.insufficientEvidence).toBe(true);

    expect(afterAiRightsRemoval.citations).toHaveLength(0);

    expect(afterAiRightsRemoval.propositions).toHaveLength(0);

    /**
     * Directly confirm the corpus rights function also sees the new
     * append-only decision as authoritative.
     */
    await database.withAdmin(async (admin) => {
      const rights = await admin.query<{
        readonly allowed: boolean;
      }>(
        `
                  SELECT
                    corpus.source_allows(
                      $1,
                      'ai_processing'
                    ) AS allowed
                `,
        [publisherSourceId],
      );

      expect(rights.rows[0]?.allowed).toBe(false);
    });

    /**
     * PHASE 9G PRE-PERSISTENCE CORPUS RIGHTS REAUTHORIZATION
     *
     * The synthesis was created while this exact authority had current
     * ai_processing permission.
     *
     * Phase 9E has now removed that permission, but the AI Task itself is
     * still valid and ready.
     *
     * This isolates the source-rights boundary from the task-status
     * boundary: persistence must reject the exact formerly-valid
     * source/version because current corpus rights no longer authorize it.
     */
    const previouslyAuthorizedSynthesisProvenance: WorkProductSourceReference[] = [
      {
        kind: 'corpus_document_version',

        sourceId: legalDocumentId,

        versionId,

        locator: 'paragraph:1',
      },
    ];

    /**
     * Confirm the task remains valid before testing stale source rights.
     */
    const taskBeforeRightsPersistence = await run(orgA, (tx) =>
      tx.query<{
        readonly status: string;
      }>(
        `
                  SELECT status
                  FROM ai_tasks.tasks
                  WHERE id = $1
                `,
        [p.aiTaskId],
      ),
    );

    expect(taskBeforeRightsPersistence.rows[0]?.status).toBe('ready');

    /**
     * The exact authority was valid during synthesis but is now stale for
     * AI use.
     *
     * Work Product persistence must independently re-read the exact
     * source/version and current corpus.source_allows(...,'ai_processing')
     * result before making anything durable.
     */
    await expect(
      authorizedAppend(p, previouslyAuthorizedSynthesisProvenance),
    ).rejects.toMatchObject({
      code: 'work_product.source_unavailable',
    });

    const revisionsAfterRightsRemoval = await run(orgA, (tx) => store.listRevisions(tx, p.id));

    expect(revisionsAfterRightsRemoval).toHaveLength(0);

    const auditAfterRightsRemoval = await run(orgA, (tx) =>
      tx.query<{
        readonly count: number;
      }>(
        `
                  SELECT
                    count(*)::int AS count
                  FROM audit.events
                  WHERE action =
                    'work_product.revision_created'
                    AND metadata
                      ->> 'work_product_id'
                      = $1
                `,
        [p.id],
      ),
    );

    expect(auditAfterRightsRemoval.rows[0]?.count).toBe(0);

    /**
     * PHASE 9F PRE-PERSISTENCE REAUTHORIZATION ACCEPTANCE
     *
     * The synthesis above was grounded while the AI Task and source were
     * authorized.
     *
     * That previously generated output is NOT itself permission to persist
     * evidence later.
     *
     * Invalidate the server-owned task after synthesis and prove the Work
     * Product persistence boundary reauthorizes the task immediately before
     * writing a revision.
     */
    /**
     * Use the same valid state transition already exercised by the Phase 7
     * stale-source acceptance suite. The purpose here is not to retest the
     * cancel-task command; it is to create a real post-synthesis stale-task
     * condition before persistence.
     */
    await run(orgA, (tx) =>
      tx.query(
        `
                UPDATE ai_tasks.tasks
                SET status = 'cancelled'
                WHERE id = $1
              `,
        [p.aiTaskId],
      ),
    );

    const cancelledTask = await run(orgA, (tx) =>
      tx.query<{
        readonly status: string;
      }>(
        `
                  SELECT status
                  FROM ai_tasks.tasks
                  WHERE id = $1
                `,
        [p.aiTaskId],
      ),
    );

    expect(cancelledTask.rows[0]?.status).toBe('cancelled');

    /**
     * This provenance was valid when synthesis ran.
     *
     * Persistence must NOT trust that historical fact. It must re-check:
     *
     * - the current tenant;
     * - the current task;
     * - the exact task scope revision;
     * - the exact source/version;
     * - current source rights.
     *
     * Because the task is now cancelled, persistence must fail closed
     * before any revision or success audit event is durable.
     */
    await expect(
      authorizedAppend(p, previouslyAuthorizedSynthesisProvenance),
    ).rejects.toMatchObject({
      code: 'work_product.task_scope_unavailable',
    });

    const revisionsAfterCancellation = await run(orgA, (tx) => store.listRevisions(tx, p.id));

    expect(revisionsAfterCancellation).toHaveLength(0);

    const revisionAuditAfterCancellation = await run(orgA, (tx) =>
      tx.query<{
        readonly count: number;
      }>(
        `
                  SELECT
                    count(*)::int AS count
                  FROM audit.events
                  WHERE action =
                    'work_product.revision_created'
                    AND metadata
                      ->> 'work_product_id'
                      = $1
                `,
        [p.id],
      ),
    );

    expect(revisionAuditAfterCancellation.rows[0]?.count).toBe(0);
  });
});
