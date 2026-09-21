import { randomUUID } from 'node:crypto';

import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, withTenantTransaction, type Tx } from '@legalintel/db';
import { createTestDatabase } from '@legalintel/db/testing';
import { entitlementMigrations } from '@legalintel/entitlements';
import { iamMigrations } from '@legalintel/iam';
import { OrganizationId, UserId } from '@legalintel/kernel';
import { knowledgeMigrations } from '@legalintel/knowledge';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { ingestionMigrations } from '@legalintel/legal-ingestion';
import { matterDocumentMigrations } from '@legalintel/matter-documents';
import { pgWorkspaceStore, workspaceMigrations } from '@legalintel/workspace';

import { aiTaskMigrations } from '../src';

export const migrationSets = [
  platformMigrations,
  iamMigrations,
  auditMigrations,
  corpusMigrations,
  entitlementMigrations,
  workspaceMigrations,
  knowledgeMigrations,
  matterDocumentMigrations,
  aiTaskMigrations,
  ingestionMigrations,
];

// Fixture arrangement uses the repository's real isolated-PostgreSQL harness.
export async function createTaskWorld() {
  const database = await createTestDatabase({ migrationSets });
  const pool = database.poolFor('app', { max: 8 });
  const orgA = OrganizationId.generate();
  const orgB = OrganizationId.generate();
  const userA = UserId.generate();
  const userB = UserId.generate();
  const gh = JurisdictionId.generate();
  const unsupported = JurisdictionId.generate();
  await database.withAdmin(async (c) => {
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await c.query('INSERT INTO iam.users(id,email,display_name) VALUES ($1,$2,$3)', [
        user,
        `${user}@example.test`,
        'SYNTHETIC Phase 6 actor',
      ]);
      await c.query("INSERT INTO iam.organizations(id,name,slug,kind) VALUES ($1,$2,$3,'firm')", [
        org,
        'SYNTHETIC Phase 6 firm',
        `phase6-${org}`,
      ]);
      await c.query('INSERT INTO iam.memberships(organization_id,user_id) VALUES ($1,$2)', [
        org,
        user,
      ]);
      await c.query(
        "SELECT set_config('app.org_id',$1,false), set_config('app.user_id',$2,false)",
        [org, user],
      );
      await c.query(
        "INSERT INTO iam.role_assignments(organization_id,user_id,role_key,granted_by) VALUES ($1,$2,'owner',$2)",
        [org, user],
      );
    }
    await c.query(
      "INSERT INTO corpus.jurisdictions(id,code,name,kind,is_synthetic) VALUES ($1,'GH','Ghana','country',false),($2,'ZZ-UNSUP','SYNTHETIC unsupported sentinel','region',true)",
      [gh, unsupported],
    );
    for (const org of [orgA, orgB]) {
      await c.query(
        'INSERT INTO policy.organization_jurisdictions(id,organization_id,jurisdiction_id) VALUES ($1,$2,$3)',
        [randomUUID(), org, gh],
      );
    }
  });
  const run = <T>(
    org: OrganizationId,
    fn: (tx: Tx) => Promise<T>,
    user = org === orgA ? userA : userB,
  ) => withTenantTransaction(pool, { organizationId: org, userId: user }, fn);
  const matter = async (org: OrganizationId) =>
    run(org, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, { name: 'SYNTHETIC client' });
      return pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId: gh,
        name: 'SYNTHETIC matter',
      });
    });
  const matterA = await matter(orgA);
  const matterB = await matter(orgB);
  return { database, pool, orgA, orgB, userA, userB, gh, unsupported, run, matterA, matterB };
}
export type TaskWorld = Awaited<ReturnType<typeof createTaskWorld>>;

export async function insertTask(tx: Tx, userId: string, id = randomUUID()) {
  await tx.query(
    `INSERT INTO ai_tasks.tasks(organization_id,id,requested_by_user_id,employee_type,title,instructions)
    VALUES (app.current_org_id(),$1,$2,'research_associate','SYNTHETIC task','SYNTHETIC private instructions')`,
    [id, userId],
  );
  return id;
}
export async function insertScope(
  tx: Tx,
  w: TaskWorld,
  id: string,
  input: {
    revision?: number;
    jurisdictionId?: string;
    jurisdictionCode?: string;
    mode?: string;
    matterId?: string | null;
  } = {},
) {
  await tx.query(
    `INSERT INTO ai_tasks.task_scope_revisions
    (organization_id,task_id,revision,jurisdiction_id,jurisdiction_code,scope_mode,matter_id,created_by_user_id)
    VALUES (app.current_org_id(),$1,$2,$3,$4,$5,$6,app.current_user_id())`,
    [
      id,
      input.revision ?? 1,
      input.jurisdictionId ?? w.gh,
      input.jurisdictionCode ?? 'GH',
      input.mode ?? 'ghana_corpus',
      input.matterId ?? null,
    ],
  );
}
export async function rawTask(w: TaskWorld, input: Parameters<typeof insertScope>[3] = {}) {
  return w.run(w.orgA, async (tx) => {
    const id = await insertTask(tx, w.userA);
    await insertScope(tx, w, id, input);
    return id;
  });
}
