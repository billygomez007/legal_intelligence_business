import { randomUUID } from 'node:crypto';

import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, withTenantTransaction, type DbPool, type Tx } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations, type AuthzContext } from '@legalintel/iam';
import { ApiKeyId, OrganizationId, UserId } from '@legalintel/kernel';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { pgWorkspaceStore, workspaceMigrations } from '@legalintel/workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  archiveMatterDocument,
  createMatterDocument,
  createMatterDocumentVersion,
  getMatterDocument,
  listMatterDocuments,
  listMatterDocumentVersions,
  matterDocumentMigrations,
  matterDocumentPermissionContribution,
  PgMatterDocumentStore,
  updateMatterDocument,
  type CreateMatterDocumentVersionRequest,
  type MatterDocumentId,
} from '../src';

const fullPermissions = [
  'matter-document:create',
  'matter-document:read',
  'matter-document:update',
  'matter-document:version:create',
  'matter-document:version:read',
] as const;

const readPermissions = ['matter-document:read', 'matter-document:version:read'] as const;

type FixtureRole = 'owner' | 'admin' | 'member' | 'viewer';
type DocumentAuditAction =
  | 'matter_document.created'
  | 'matter_document.updated'
  | 'matter_document.archived'
  | 'matter_document.version_created';

interface AuditRow {
  actor_kind: string;
  actor_id: string | null;
  action: string;
  outcome: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
}

// Keep the audit-failure constraints local to this isolated suite/database.
// Sequential execution is intentional: those constraints must not overlap.
describe(
  'Matter Documents PostgreSQL application and security behavior',
  { concurrent: false },
  () => {
    const store = new PgMatterDocumentStore();
    const organizationA = OrganizationId.parse(randomUUID());
    const organizationB = OrganizationId.parse(randomUUID());
    const ownerUserId = UserId.parse(randomUUID());
    const memberUserId = UserId.parse(randomUUID());
    const viewerUserId = UserId.parse(randomUUID());
    const apiKeyCreatorId = UserId.parse(randomUUID());

    let database: TestDatabase;
    let databaseInitialized = false;
    let pool: DbPool;
    let ghanaJurisdictionId: JurisdictionId;
    let matterAId: string;
    let secondMatterAId: string;
    let matterBId: string;

    function userContext(
      role: FixtureRole = 'owner',
      organizationId: OrganizationId = organizationA,
    ): AuthzContext {
      return {
        principal: {
          kind: 'user',
          userId: role === 'viewer' ? viewerUserId : role === 'member' ? memberUserId : ownerUserId,
        },
        organizationId,
        roles: [role],
        permissions: new Set(matterDocumentPermissionContribution.orgRoleGrants[role]),
      };
    }

    function runAs<T>(context: AuthzContext, work: (tx: Tx) => Promise<T>): Promise<T> {
      const organizationId = context.organizationId;
      if (!organizationId) {
        throw new Error('The test requires an explicit tenant context.');
      }
      const principal = context.principal;
      const userId =
        principal.kind === 'user'
          ? principal.userId
          : principal.kind === 'api_key'
            ? principal.createdBy
            : undefined;

      return withTenantTransaction(
        pool,
        { organizationId, ...(userId === undefined ? {} : { userId }) },
        work,
      );
    }

    function versionRequest(documentId: MatterDocumentId): CreateMatterDocumentVersionRequest {
      return {
        documentId,
        originalFilename: 'ghana-matter-evidence.pdf',
        mimeType: 'application/pdf',
        storageKey: `private/ghana/${documentId}/${randomUUID()}.pdf`,
        contentSha256: 'a'.repeat(64),
        sizeBytes: 4096,
      };
    }

    function createDocumentFixture(
      name: string,
      matterId: string = matterAId,
      context: AuthzContext = userContext(),
    ) {
      return runAs(context, (tx) => createMatterDocument(store, tx, context, { matterId, name }));
    }

    function auditFor(context: AuthzContext, resourceId: string): Promise<AuditRow[]> {
      return runAs(context, async (tx) => {
        const result = await tx.query<AuditRow>(
          `SELECT actor_kind, actor_id, action, outcome, resource_type, resource_id, metadata
         FROM audit.events
         WHERE resource_id = $1
         ORDER BY action`,
          [resourceId],
        );
        return result.rows;
      });
    }

    function successAuditCount(context: AuthzContext): Promise<string> {
      return runAs(context, async (tx) => {
        const result = await tx.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM audit.events
         WHERE action LIKE 'matter_document.%' AND outcome = 'success'`,
        );
        const row = result.rows[0];
        if (!row) throw new Error('Missing audit count result.');
        return row.count;
      });
    }

    const auditFailureConstraint = 'phase5a_reject_matter_document_audit';

    async function withRejectedAudit(
      action: DocumentAuditAction,
      assertions: () => Promise<void>,
    ): Promise<void> {
      // These are fixed test-only action literals, never caller-supplied SQL.
      // DDL uses the admin fixture connection, not the application role.
      // NOT VALID permits earlier audit rows while rejecting the new write.
      await database.withAdmin((admin) =>
        admin.query(
          `ALTER TABLE audit.events ADD CONSTRAINT ${auditFailureConstraint}
         CHECK (action <> '${action}') NOT VALID`,
        ),
      );
      try {
        await assertions();
      } finally {
        await database.withAdmin((admin) =>
          admin.query(`ALTER TABLE audit.events DROP CONSTRAINT ${auditFailureConstraint}`),
        );
      }
    }

    beforeAll(async () => {
      database = await createTestDatabase({
        migrationSets: [
          platformMigrations,
          iamMigrations,
          auditMigrations,
          corpusMigrations,
          workspaceMigrations,
          matterDocumentMigrations,
        ],
      });
      databaseInitialized = true;
      pool = database.poolFor('app', { max: 4 });

      ghanaJurisdictionId = await database.withAdmin(async (admin) => {
        for (const [id, label] of [
          [ownerUserId, 'owner'],
          [memberUserId, 'member'],
          [viewerUserId, 'viewer'],
          [apiKeyCreatorId, 'api-key-creator'],
        ] as const) {
          await admin.query(`INSERT INTO iam.users (id, email, display_name) VALUES ($1, $2, $3)`, [
            id,
            `phase5a-${id}@example.test`,
            `Phase 5A ${label}`,
          ]);
        }
        for (const [id, label] of [
          [organizationA, 'A'],
          [organizationB, 'B'],
        ] as const) {
          await admin.query(
            `INSERT INTO iam.organizations (id, name, slug, kind)
           VALUES ($1, $2, $3, 'firm')`,
            [id, `Phase 5A Ghana Firm ${label}`, `phase5a-${id}`],
          );
        }
        const result = await admin.query<{ id: string }>(
          `INSERT INTO corpus.jurisdictions (code, name, kind, is_synthetic)
         VALUES ('GH', 'Ghana', 'country', false) RETURNING id`,
        );
        const row = result.rows[0];
        if (!row) throw new Error('Ghana jurisdiction fixture was not created.');
        return JurisdictionId.parse(row.id);
      });

      // Arrange already-existing Ghana matters through the Workspace store.
      // This suite tests document services, not Workspace entitlement resolution.
      async function makeMatter(organizationId: OrganizationId, suffix: string): Promise<string> {
        return withTenantTransaction(pool, { organizationId, userId: ownerUserId }, async (tx) => {
          const client = await pgWorkspaceStore.createClient(tx, {
            name: `Phase 5A Ghana Client ${suffix}`,
          });
          const matter = await pgWorkspaceStore.createMatter(tx, {
            clientId: client.id,
            jurisdictionId: ghanaJurisdictionId,
            name: `Phase 5A Ghana Matter ${suffix}`,
          });
          expect(matter.jurisdictionId).toBe(ghanaJurisdictionId);
          return matter.id;
        });
      }
      matterAId = await makeMatter(organizationA, 'A1');
      secondMatterAId = await makeMatter(organizationA, 'A2');
      matterBId = await makeMatter(organizationB, 'B1');
    }, 120000);

    afterAll(async () => {
      // TestDatabase.dispose() owns and closes pools registered by poolFor().
      if (databaseInitialized) await database.dispose();
    }, 120000);

    it('runs document operations as the non-superuser application role without RLS bypass', async () => {
      const result = await runAs(userContext(), (tx) =>
        tx.query<{ role_name: string; rolsuper: boolean; rolbypassrls: boolean }>(
          `SELECT current_user AS role_name, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
        ),
      );
      expect(result.rows).toEqual([
        { role_name: 'legalintel_app', rolsuper: false, rolbypassrls: false },
      ]);
    });

    it('preserves full owner/admin/member grants, viewer read-only grants, and no staff grants', () => {
      expect(
        matterDocumentPermissionContribution.permissions.map((item) => item.key).sort(),
      ).toEqual([...fullPermissions].sort());
      for (const role of ['owner', 'admin', 'member'] as const) {
        expect([...matterDocumentPermissionContribution.orgRoleGrants[role]].sort()).toEqual(
          [...fullPermissions].sort(),
        );
      }
      expect([...matterDocumentPermissionContribution.orgRoleGrants.viewer].sort()).toEqual(
        [...readPermissions].sort(),
      );
      expect(matterDocumentPermissionContribution.staffRoleGrants).toEqual({});
    });

    it('creates, reads, lists, updates and archives a document with the three mutation audits', async () => {
      const context = userContext();
      const document = await runAs(context, (tx) =>
        createMatterDocument(store, tx, context, {
          matterId: matterAId,
          name: 'Ghana pleading',
          description: 'Private matter metadata',
        }),
      );
      expect(document).toMatchObject({
        organizationId: organizationA,
        matterId: matterAId,
        name: 'Ghana pleading',
        description: 'Private matter metadata',
        status: 'active',
      });
      expect(
        await runAs(context, (tx) => getMatterDocument(store, tx, context, document.id)),
      ).toEqual(document);
      const other = await createDocumentFixture('Separate Ghana matter document', secondMatterAId);
      const listed = await runAs(context, (tx) =>
        listMatterDocuments(store, tx, context, matterAId),
      );
      expect(listed.some((row) => row.id === document.id)).toBe(true);
      expect(listed.some((row) => row.id === other.id)).toBe(false);

      const updated = await runAs(context, (tx) =>
        updateMatterDocument(store, tx, context, {
          id: document.id,
          name: 'Revised Ghana pleading',
          description: 'Revised private metadata',
        }),
      );
      expect(updated).toMatchObject({ id: document.id, name: 'Revised Ghana pleading' });
      const archived = await runAs(context, (tx) =>
        archiveMatterDocument(store, tx, context, document.id),
      );
      expect(archived.status).toBe('archived');
      const active = await runAs(context, (tx) =>
        listMatterDocuments(store, tx, context, matterAId, 'active'),
      );
      const archivedList = await runAs(context, (tx) =>
        listMatterDocuments(store, tx, context, matterAId, 'archived'),
      );
      expect(active.some((row) => row.id === document.id)).toBe(false);
      expect(archivedList.some((row) => row.id === document.id)).toBe(true);

      const events = await auditFor(context, document.id);
      expect(events).toHaveLength(3);
      for (const action of [
        'matter_document.created',
        'matter_document.updated',
        'matter_document.archived',
      ]) {
        expect(events.find((event) => event.action === action)).toEqual({
          actor_kind: 'user',
          actor_id: ownerUserId,
          action,
          outcome: 'success',
          resource_type: 'matter_document',
          resource_id: document.id,
          metadata: { matterId: matterAId },
        });
      }
    });

    it('allows a member to create versions 1 and 2, omits storage secrets from audit, and retains versions after archival', async () => {
      const context = userContext('member');
      const document = await createDocumentFixture('Member Ghana evidence', matterAId, context);
      const firstRequest = versionRequest(document.id);
      const first = await runAs(context, (tx) =>
        createMatterDocumentVersion(store, tx, context, firstRequest),
      );
      const second = await runAs(context, (tx) =>
        createMatterDocumentVersion(store, tx, context, versionRequest(document.id)),
      );
      expect([first.versionNumber, second.versionNumber]).toEqual([1, 2]);
      expect(first).toMatchObject({
        organizationId: organizationA,
        matterId: matterAId,
        documentId: document.id,
        storageKey: firstRequest.storageKey,
        contentSha256: firstRequest.contentSha256,
      });
      expect(await auditFor(context, first.id)).toEqual([
        {
          actor_kind: 'user',
          actor_id: memberUserId,
          action: 'matter_document.version_created',
          outcome: 'success',
          resource_type: 'matter_document_version',
          resource_id: first.id,
          metadata: {
            matterId: matterAId,
            documentId: document.id,
            versionNumber: 1,
            sizeBytes: 4096,
          },
        },
      ]);
      await runAs(context, (tx) => archiveMatterDocument(store, tx, context, document.id));
      const versions = await runAs(context, (tx) =>
        listMatterDocumentVersions(store, tx, context, document.id),
      );
      expect(versions.map((row) => row.id)).toEqual([second.id, first.id]);
      expect(versions.map((row) => row.versionNumber)).toEqual([2, 1]);
    });

    it('lets a viewer read documents and versions but denies all four mutations without success audits', async () => {
      const owner = userContext();
      const viewer = userContext('viewer');
      const document = await createDocumentFixture('Viewer access Ghana document');
      const version = await runAs(owner, (tx) =>
        createMatterDocumentVersion(store, tx, owner, versionRequest(document.id)),
      );
      expect(
        (await runAs(viewer, (tx) => getMatterDocument(store, tx, viewer, document.id))).id,
      ).toBe(document.id);
      expect(
        (await runAs(viewer, (tx) => listMatterDocuments(store, tx, viewer, matterAId))).some(
          (row) => row.id === document.id,
        ),
      ).toBe(true);
      expect(
        (
          await runAs(viewer, (tx) => listMatterDocumentVersions(store, tx, viewer, document.id))
        ).map((row) => row.id),
      ).toEqual([version.id]);

      const before = await successAuditCount(owner);
      const deniedName = `Viewer denied ${randomUUID()}`;
      const denied: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => createMatterDocument(store, tx, viewer, { matterId: matterAId, name: deniedName }),
        (tx) =>
          updateMatterDocument(store, tx, viewer, { id: document.id, name: 'Forbidden update' }),
        (tx) => archiveMatterDocument(store, tx, viewer, document.id),
        (tx) => createMatterDocumentVersion(store, tx, viewer, versionRequest(document.id)),
      ];
      for (const operation of denied) {
        await expect(runAs(viewer, operation)).rejects.toMatchObject({ code: 'authz.denied' });
      }
      expect(await successAuditCount(owner)).toBe(before);
      expect(await runAs(owner, (tx) => getMatterDocument(store, tx, owner, document.id))).toEqual(
        document,
      );
      expect(
        (await runAs(owner, (tx) => listMatterDocuments(store, tx, owner, matterAId))).some(
          (row) => row.name === deniedName,
        ),
      ).toBe(false);
      expect(
        await runAs(owner, (tx) => listMatterDocumentVersions(store, tx, owner, document.id)),
      ).toHaveLength(1);
    });

    it('requires explicit permissions on every application service even when the context names the owner role', async () => {
      const document = await createDocumentFixture('Explicit-permission Ghana document');
      const context: AuthzContext = { ...userContext(), permissions: new Set() };
      const before = await successAuditCount(userContext());
      const operations: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => createMatterDocument(store, tx, context, { matterId: matterAId, name: 'Denied' }),
        (tx) => getMatterDocument(store, tx, context, document.id),
        (tx) => listMatterDocuments(store, tx, context, matterAId),
        (tx) => updateMatterDocument(store, tx, context, { id: document.id, name: 'Denied' }),
        (tx) => archiveMatterDocument(store, tx, context, document.id),
        (tx) => createMatterDocumentVersion(store, tx, context, versionRequest(document.id)),
        (tx) => listMatterDocumentVersions(store, tx, context, document.id),
      ];
      for (const operation of operations) {
        await expect(runAs(context, operation)).rejects.toMatchObject({ code: 'authz.denied' });
      }
      expect(await successAuditCount(userContext())).toBe(before);
    });

    it('attributes API-key document and version audits to createdBy rather than the key id', async () => {
      const apiKeyId = ApiKeyId.parse(randomUUID());
      const context: AuthzContext = {
        principal: { kind: 'api_key', apiKeyId, createdBy: apiKeyCreatorId },
        organizationId: organizationA,
        roles: [],
        permissions: new Set(['matter-document:create', 'matter-document:version:create']),
      };
      const document = await createDocumentFixture('API-key Ghana document', matterAId, context);
      const version = await runAs(context, (tx) =>
        createMatterDocumentVersion(store, tx, context, versionRequest(document.id)),
      );
      for (const resourceId of [document.id, version.id]) {
        const events = await auditFor(userContext(), resourceId);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ actor_kind: 'api_key', actor_id: apiKeyCreatorId });
        expect(events[0]?.actor_id).not.toBe(apiKeyId);
      }
    });

    it('hides another tenants document, versions and audit rows and refuses cross-tenant mutations', async () => {
      const owner = userContext();
      const other = userContext('owner', organizationB);
      const document = await createDocumentFixture('Firm A confidential Ghana document');
      const version = await runAs(owner, (tx) =>
        createMatterDocumentVersion(store, tx, owner, versionRequest(document.id)),
      );
      expect(await runAs(other, (tx) => listMatterDocuments(store, tx, other, matterAId))).toEqual(
        [],
      );
      expect(await auditFor(other, document.id)).toEqual([]);
      expect(await auditFor(other, version.id)).toEqual([]);
      expect(await runAs(other, (tx) => store.listDocumentVersions(tx, document.id))).toEqual([]);
      const before = await successAuditCount(other);
      const operations: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => getMatterDocument(store, tx, other, document.id),
        (tx) => listMatterDocumentVersions(store, tx, other, document.id),
        (tx) =>
          updateMatterDocument(store, tx, other, { id: document.id, name: 'Cross-tenant update' }),
        (tx) => archiveMatterDocument(store, tx, other, document.id),
        (tx) => createMatterDocumentVersion(store, tx, other, versionRequest(document.id)),
      ];
      for (const operation of operations) {
        await expect(runAs(other, operation)).rejects.toMatchObject({
          code: 'matter_documents.document_not_found',
        });
      }
      expect(await successAuditCount(other)).toBe(before);
      expect(await runAs(owner, (tx) => getMatterDocument(store, tx, owner, document.id))).toEqual(
        document,
      );
    });

    it('rejects creating a document against another organizations matter through the composite FK', async () => {
      const context = userContext();
      const name = `Foreign matter document ${randomUUID()}`;
      const before = await successAuditCount(context);
      await expect(
        runAs(context, (tx) =>
          createMatterDocument(store, tx, context, { matterId: matterBId, name }),
        ),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'matter_documents_documents_matter_fkey',
      });
      const result = await runAs(context, (tx) =>
        tx.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM matter_documents.documents WHERE name = $1',
          [name],
        ),
      );
      expect(result.rows[0]?.count).toBe('0');
      expect(await successAuditCount(context)).toBe(before);
    });

    it('rejects a raw version linked to a different matter in the same organization', async () => {
      const context = userContext();
      const document = await createDocumentFixture('Composite FK Ghana document');
      const forgedId = randomUUID();
      await expect(
        runAs(context, (tx) =>
          tx.query(
            `INSERT INTO matter_documents.document_versions
         (organization_id, id, matter_id, document_id, version_number,
          original_filename, mime_type, storage_key, content_sha256, size_bytes)
       VALUES ($1, $2, $3, $4, 1, 'evidence.pdf', 'application/pdf', $5, $6, 1)`,
            [
              organizationA,
              forgedId,
              secondMatterAId,
              document.id,
              `forged/${forgedId}`,
              'b'.repeat(64),
            ],
          ),
        ),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'matter_documents_document_versions_document_fkey',
      });
      expect(
        await runAs(context, (tx) => listMatterDocumentVersions(store, tx, context, document.id)),
      ).toEqual([]);
    });

    it('rejects an explicit organization-id spoof on a raw runtime INSERT under RLS', async () => {
      const forgedId = randomUUID();
      await expect(
        runAs(userContext('owner', organizationB), (tx) =>
          tx.query(
            `INSERT INTO matter_documents.documents (organization_id, id, matter_id, name)
       VALUES ($1, $2, $3, 'Spoofed tenant document')`,
            [organizationA, forgedId, matterAId],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const result = await database.withAdmin((admin) =>
        admin.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM matter_documents.documents WHERE id = $1',
          [forgedId],
        ),
      );
      expect(result.rows[0]?.count).toBe('0');
    });

    it('rejects actual runtime document DELETE and version UPDATE/DELETE without changing persisted data', async () => {
      const context = userContext();
      const document = await createDocumentFixture('Immutable Ghana evidence');
      const version = await runAs(context, (tx) =>
        createMatterDocumentVersion(store, tx, context, versionRequest(document.id)),
      );
      const operations: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx.query('DELETE FROM matter_documents.documents WHERE id = $1', [document.id]),
        (tx) =>
          tx.query(
            "UPDATE matter_documents.document_versions SET original_filename = 'changed.pdf' WHERE id = $1",
            [version.id],
          ),
        (tx) =>
          tx.query('DELETE FROM matter_documents.document_versions WHERE id = $1', [version.id]),
      ];
      for (const operation of operations) {
        await expect(runAs(context, operation)).rejects.toMatchObject({ code: '42501' });
      }
      expect(
        await runAs(context, (tx) => getMatterDocument(store, tx, context, document.id)),
      ).toEqual(document);
      expect(
        await runAs(context, (tx) => listMatterDocumentVersions(store, tx, context, document.id)),
      ).toEqual([version]);
    });

    it('rolls document creation back on a genuine audit CHECK violation and writes no success audit', async () => {
      const context = userContext();
      const name = `Audit rollback Ghana document ${randomUUID()}`;
      const before = await successAuditCount(context);
      await withRejectedAudit('matter_document.created', async () => {
        await expect(
          runAs(context, (tx) =>
            createMatterDocument(store, tx, context, { matterId: matterAId, name }),
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: auditFailureConstraint,
        });
      });
      const result = await runAs(context, (tx) =>
        tx.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM matter_documents.documents WHERE name = $1',
          [name],
        ),
      );
      expect(result.rows[0]?.count).toBe('0');
      expect(await successAuditCount(context)).toBe(before);
    });

    it('rolls version creation back on audit failure and reuses the uncommitted version number', async () => {
      const context = userContext();
      const document = await createDocumentFixture('Version audit rollback Ghana document');
      const first = await runAs(context, (tx) =>
        createMatterDocumentVersion(store, tx, context, versionRequest(document.id)),
      );
      const rejectedRequest = versionRequest(document.id);
      const before = await successAuditCount(context);
      await withRejectedAudit('matter_document.version_created', async () => {
        await expect(
          runAs(context, (tx) => createMatterDocumentVersion(store, tx, context, rejectedRequest)),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: auditFailureConstraint,
        });
      });
      expect(
        await runAs(context, (tx) => listMatterDocumentVersions(store, tx, context, document.id)),
      ).toEqual([first]);
      expect(await successAuditCount(context)).toBe(before);
      const second = await runAs(context, (tx) =>
        createMatterDocumentVersion(store, tx, context, versionRequest(document.id)),
      );
      expect(second.versionNumber).toBe(2);
    });

    it.each(['updated', 'archived'] as const)(
      'rolls a document %s mutation back when its audit fails',
      async (operation) => {
        const context = userContext();
        const document = await createDocumentFixture(
          `Mutation rollback Ghana document ${operation}`,
        );
        const before = await successAuditCount(context);
        const action =
          operation === 'updated' ? 'matter_document.updated' : 'matter_document.archived';
        await withRejectedAudit(action, async () => {
          await expect(
            runAs(context, (tx) =>
              operation === 'updated'
                ? updateMatterDocument(store, tx, context, {
                    id: document.id,
                    name: 'Must roll back',
                  })
                : archiveMatterDocument(store, tx, context, document.id),
            ),
          ).rejects.toMatchObject({ code: '23514', constraint: auditFailureConstraint });
        });
        expect(
          await runAs(context, (tx) => getMatterDocument(store, tx, context, document.id)),
        ).toEqual(document);
        expect(await successAuditCount(context)).toBe(before);
      },
    );
  },
);
