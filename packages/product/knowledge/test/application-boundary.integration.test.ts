import { randomUUID } from 'node:crypto';

import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations, type AuthzContext } from '@legalintel/iam';
import { ApiKeyId, UserId } from '@legalintel/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgKnowledgeStore } from '../src/adapters/pg-knowledge-store';
import { archiveKnowledgeSource } from '../src/application/archive-source';
import { createKnowledgeSource } from '../src/application/create-source';
import { createKnowledgeSourceVersion } from '../src/application/create-source-version';
import { getKnowledgeSource } from '../src/application/get-source';
import { listKnowledgeSourceVersions } from '../src/application/list-source-versions';
import { listKnowledgeSources } from '../src/application/list-sources';
import { updateKnowledgeSource } from '../src/application/update-source';
import { knowledgeMigrations } from '../src/migrations';

type TenantScope = Parameters<typeof withTenantTransaction>[1];
type OrganizationId = TenantScope['organizationId'];

describe('Firm Knowledge application boundary', () => {
  const pgKnowledgeStore = new PgKnowledgeStore();
  let database!: TestDatabase;
  let pool!: DbPool;

  const organizationA = randomUUID() as OrganizationId;
  const organizationB = randomUUID() as OrganizationId;

  const ownerUserId = UserId.parse(randomUUID());
  const memberUserId = UserId.parse(randomUUID());
  const apiKeyCreatorId = UserId.parse(randomUUID());

  const ownerContext = (): AuthzContext => ({
    principal: {
      kind: 'user',
      userId: ownerUserId,
    },
    organizationId: organizationA,
    roles: ['owner'],
    permissions: new Set([
      'knowledge:source:create',
      'knowledge:source:read',
      'knowledge:source:update',
      'knowledge:version:create',
      'knowledge:version:read',
    ]),
  });

  const memberContext = (): AuthzContext => ({
    principal: {
      kind: 'user',
      userId: memberUserId,
    },
    organizationId: organizationA,
    roles: ['member'],
    permissions: new Set(['knowledge:source:read', 'knowledge:version:read']),
  });

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, auditMigrations, knowledgeMigrations],
    });

    pool = database.poolFor('app', { max: 8 });

    await database.withAdmin(async (client) => {
      await client.query(
        `INSERT INTO iam.organizations (
           id,
           name,
           slug,
           kind
         )
         VALUES
           ($1, $2, $3, 'firm'),
           ($4, $5, $6, 'firm')`,
        [
          organizationA,
          'Phase 4B Application Firm A',
          `phase4b-app-a-${organizationA}`,
          organizationB,
          'Phase 4B Application Firm B',
          `phase4b-app-b-${organizationB}`,
        ],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('creates a Firm Knowledge source and writes its audit event atomically', async () => {
    const created = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: ownerUserId,
      },
      (tx) =>
        createKnowledgeSource(pgKnowledgeStore, tx, ownerContext(), {
          name: 'Ghana Litigation Handbook',
          description: 'Approved internal firm guidance.',
        }),
    );

    expect(created.organizationId).toBe(organizationA);
    expect(created.status).toBe('active');

    const audit = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      (tx) =>
        tx.query<{
          actor_kind: string;
          actor_id: string | null;
          action: string;
          outcome: string;
          resource_type: string | null;
          resource_id: string | null;
          metadata: Record<string, unknown>;
        }>(
          `SELECT
             actor_kind,
             actor_id,
             action,
             outcome,
             resource_type,
             resource_id,
             metadata
           FROM audit.events
           WHERE action = 'knowledge.source_created'
           ORDER BY occurred_at DESC
           LIMIT 1`,
        ),
      { readOnly: true },
    );

    expect(audit.rows[0]).toMatchObject({
      actor_kind: 'user',
      actor_id: ownerUserId,
      action: 'knowledge.source_created',
      outcome: 'success',
      resource_type: 'knowledge_source',
      resource_id: created.id,
      metadata: {},
    });
  });

  it('allows a member to read Firm Knowledge but denies source mutation', async () => {
    const source = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: ownerUserId,
      },
      (tx) =>
        createKnowledgeSource(pgKnowledgeStore, tx, ownerContext(), {
          name: 'Member Read Test',
        }),
    );

    const found = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: memberUserId,
      },
      (tx) => getKnowledgeSource(pgKnowledgeStore, tx, memberContext(), source.id),
      { readOnly: true },
    );

    expect(found.id).toBe(source.id);

    const listed = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: memberUserId,
      },
      (tx) => listKnowledgeSources(pgKnowledgeStore, tx, memberContext()),
      { readOnly: true },
    );

    expect(listed.some((candidate) => candidate.id === source.id)).toBe(true);

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: organizationA,
          userId: memberUserId,
        },
        (tx) =>
          updateKnowledgeSource(pgKnowledgeStore, tx, memberContext(), {
            id: source.id,
            name: 'Forbidden Member Update',
          }),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: organizationA,
          userId: memberUserId,
        },
        (tx) => archiveKnowledgeSource(pgKnowledgeStore, tx, memberContext(), source.id),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });
  });

  it('denies source creation without the create permission and writes no success audit', async () => {
    const deniedContext: AuthzContext = {
      principal: {
        kind: 'user',
        userId: memberUserId,
      },
      organizationId: organizationA,
      roles: ['member'],
      permissions: new Set(),
    };

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: organizationA,
          userId: memberUserId,
        },
        (tx) =>
          createKnowledgeSource(pgKnowledgeStore, tx, deniedContext, {
            name: 'Forbidden Source',
          }),
      ),
    ).rejects.toMatchObject({
      code: 'authz.denied',
    });

    const audit = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      (tx) =>
        tx.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM audit.events
           WHERE action = 'knowledge.source_created'
             AND actor_id = $1
             AND metadata ->> 'name' = 'Forbidden Source'`,
          [memberUserId],
        ),
      { readOnly: true },
    );

    expect(audit.rows[0]?.count).toBe('0');
  });

  it('creates a source version, records only metadata, and exposes it to readers', async () => {
    const source = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: ownerUserId,
      },
      (tx) =>
        createKnowledgeSource(pgKnowledgeStore, tx, ownerContext(), {
          name: 'Versioned Firm Knowledge',
        }),
    );

    const storageKey = `firm/${organizationA}/${randomUUID()}.pdf`;
    const sha256 = 'e'.repeat(64);

    const created = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: ownerUserId,
      },
      (tx) =>
        createKnowledgeSourceVersion(pgKnowledgeStore, tx, ownerContext(), {
          sourceId: source.id,
          originalFilename: 'approved-guidance.pdf',
          mimeType: 'application/pdf',
          storageKey,
          contentSha256: sha256,
          sizeBytes: 4096,
        }),
    );

    expect(created.sourceId).toBe(source.id);
    expect(created.versionNumber).toBe(1);

    const versions = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: memberUserId,
      },
      (tx) => listKnowledgeSourceVersions(pgKnowledgeStore, tx, memberContext(), source.id),
      { readOnly: true },
    );

    expect(versions).toHaveLength(1);
    expect(versions[0]?.id).toBe(created.id);

    const audit = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      (tx) =>
        tx.query<{
          resource_type: string | null;
          resource_id: string | null;
          metadata: Record<string, unknown>;
        }>(
          `SELECT
             resource_type,
             resource_id,
             metadata
           FROM audit.events
           WHERE action = 'knowledge.source_version_created'
           ORDER BY occurred_at DESC
           LIMIT 1`,
        ),
      { readOnly: true },
    );

    expect(audit.rows[0]).toMatchObject({
      resource_type: 'knowledge_source_version',
      resource_id: created.id,
    });

    expect(audit.rows[0]?.metadata).toMatchObject({
      sourceId: source.id,
      versionNumber: 1,
      sizeBytes: 4096,
    });

    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain(storageKey);

    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain(sha256);
  });

  it('attributes API-key mutation audit events to the API-key creator', async () => {
    const apiKeyContext: AuthzContext = {
      principal: {
        kind: 'api_key',
        apiKeyId: ApiKeyId.parse(randomUUID()),
        createdBy: apiKeyCreatorId,
      },
      organizationId: organizationA,
      roles: [],
      permissions: new Set(['knowledge:source:create']),
    };

    const created = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: apiKeyCreatorId,
      },
      (tx) =>
        createKnowledgeSource(pgKnowledgeStore, tx, apiKeyContext, {
          name: 'API Key Created Knowledge',
        }),
    );

    const audit = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      (tx) =>
        tx.query<{
          actor_kind: string;
          actor_id: string | null;
        }>(
          `SELECT actor_kind, actor_id
           FROM audit.events
           WHERE action = 'knowledge.source_created'
             AND resource_id = $1
           LIMIT 1`,
          [created.id],
        ),
      { readOnly: true },
    );

    expect(audit.rows[0]).toEqual({
      actor_kind: 'api_key',
      actor_id: apiKeyCreatorId,
    });
  });

  it('does not expose another organizations Firm Knowledge through the application boundary', async () => {
    const source = await withTenantTransaction(
      pool,
      {
        organizationId: organizationA,
        userId: ownerUserId,
      },
      (tx) =>
        createKnowledgeSource(pgKnowledgeStore, tx, ownerContext(), {
          name: 'Firm A Confidential Knowledge',
        }),
    );

    const otherContext: AuthzContext = {
      principal: {
        kind: 'user',
        userId: memberUserId,
      },
      organizationId: organizationB,
      roles: ['member'],
      permissions: new Set(['knowledge:source:read', 'knowledge:version:read']),
    };

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: organizationB,
          userId: memberUserId,
        },
        (tx) => getKnowledgeSource(pgKnowledgeStore, tx, otherContext, source.id),
        { readOnly: true },
      ),
    ).rejects.toMatchObject({
      code: 'knowledge.source_not_found',
    });
  });

  it('rolls source creation back when its audit write fails', async () => {
    const sourceName = `Rollback Source ${randomUUID()}`;

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: organizationA,
          userId: ownerUserId,
        },
        async (tx) => {
          await tx.query(
            `ALTER TABLE audit.events
             ADD CONSTRAINT phase4b_force_audit_failure
             CHECK (action <> 'knowledge.source_created')
             NOT VALID`,
          );

          return createKnowledgeSource(pgKnowledgeStore, tx, ownerContext(), {
            name: sourceName,
          });
        },
      ),
    ).rejects.toThrow();

    const persisted = await withTenantTransaction(
      pool,
      { organizationId: organizationA },
      (tx) =>
        tx.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM knowledge.sources
           WHERE name = $1`,
          [sourceName],
        ),
      { readOnly: true },
    );

    expect(persisted.rows[0]?.count).toBe('0');
  });
});
