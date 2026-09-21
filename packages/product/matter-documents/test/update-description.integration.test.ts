import { randomUUID } from 'node:crypto';

import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { OrganizationId } from '@legalintel/kernel';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { pgWorkspaceStore, workspaceMigrations } from '@legalintel/workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgMatterDocumentStore } from '../src/adapters/pg-matter-document-store';
import { MatterDocumentId } from '../src/domain/document';
import { matterDocumentMigrations } from '../src/migrations';

describe('Matter Documents update description semantics', () => {
  const store = new PgMatterDocumentStore();

  let database: TestDatabase;
  let databaseInitialized = false;
  let pool: DbPool;

  const organizationId = OrganizationId.parse(randomUUID());
  const jurisdictionId = JurisdictionId.parse(randomUUID());

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [
        platformMigrations,
        iamMigrations,
        corpusMigrations,
        workspaceMigrations,
        matterDocumentMigrations,
      ],
    });

    databaseInitialized = true;
    pool = database.poolFor('app');

    await database.withAdmin(async (client) => {
      await client.query(
        `INSERT INTO iam.organizations (
           id,
           name,
           slug,
           kind
         )
         VALUES ($1, $2, $3, 'firm')`,
        [organizationId, 'Matter Document Update Semantics Firm', `md-update-${organizationId}`],
      );

      await client.query(
        `INSERT INTO corpus.jurisdictions (
           id,
           code,
           name,
           kind,
           is_synthetic
         )
         VALUES ($1, 'GH', 'Ghana', 'country', false)`,
        [jurisdictionId],
      );
    });
  });

  afterAll(async () => {
    if (databaseInitialized) {
      await pool.end();
      await database.dispose();
    }
  });

  it('preserves an omitted description and clears it only when null is explicit', async () => {
    await withTenantTransaction(pool, { organizationId }, async (tx) => {
      const client = await pgWorkspaceStore.createClient(tx, {
        name: 'Description Semantics Client',
        reference: 'MD-DESCRIPTION-CLIENT',
      });

      const matter = await pgWorkspaceStore.createMatter(tx, {
        clientId: client.id,
        jurisdictionId,
        name: 'Ghana Description Semantics Matter',
        reference: 'MD-DESCRIPTION-MATTER',
      });

      const created = await store.createDocument(tx, {
        id: MatterDocumentId.parse(randomUUID()),
        matterId: matter.id,
        name: 'Original Document Name',
        description: 'Preserved description',
      });

      expect(created.description).toBe('Preserved description');

      const renamed = await store.updateDocument(tx, {
        id: created.id,
        name: 'Renamed Document',
      });

      expect(renamed).not.toBeNull();
      expect(renamed?.name).toBe('Renamed Document');

      expect(renamed?.description).toBe('Preserved description');

      const cleared = await store.updateDocument(tx, {
        id: created.id,
        name: 'Renamed Document',
        description: null,
      });

      expect(cleared).not.toBeNull();
      expect(cleared?.description).toBeNull();

      const persisted = await store.findDocument(tx, created.id);

      expect(persisted?.description).toBeNull();
    });
  });
});
