import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  JurisdictionNotEntitledError,
  PgEntitlementStore,
  UnsupportedJurisdictionError,
  entitlementMigrations,
  resolveAuthorizedJurisdiction,
} from '../src';

type TenantScope = Parameters<typeof withTenantTransaction>[1];
type OrganizationId = TenantScope['organizationId'];

describe('authorized jurisdiction resolution — PostgreSQL', () => {
  let database: TestDatabase;
  let pool: DbPool;
  let orgA: OrganizationId;
  let orgB: OrganizationId;
  let ghId: JurisdictionId;

  const store = new PgEntitlementStore();

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, corpusMigrations, entitlementMigrations],
    });

    pool = database.poolFor('app');

    orgA = randomUUID() as OrganizationId;
    orgB = randomUUID() as OrganizationId;

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
          orgA,
          'Phase 2C Organization A',
          `phase2c-a-${orgA}`,
          orgB,
          'Phase 2C Organization B',
          `phase2c-b-${orgB}`,
        ],
      );

      const jurisdiction = await client.query<{ id: string }>(
        `INSERT INTO corpus.jurisdictions (
           code,
           name,
           kind,
           is_synthetic
         )
         VALUES ('GH', 'Ghana', 'country', false)
         RETURNING id`,
      );

      const row = jurisdiction.rows[0];

      if (!row) {
        throw new Error('Ghana jurisdiction was not created.');
      }

      ghId = JurisdictionId.parse(row.id);

      await client.query(
        `INSERT INTO policy.organization_jurisdictions (
           id,
           organization_id,
           jurisdiction_id,
           status,
           granted_by,
           revoked_at,
           revoked_by
         )
         VALUES (
           $1,
           $2,
           $3,
           'active',
           NULL,
           NULL,
           NULL
         )`,
        [randomUUID(), orgA, ghId],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('resolves omitted jurisdiction to entitled canonical Ghana', async () => {
    const resolved = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      resolveAuthorizedJurisdiction(store, tx),
    );

    expect(resolved).toBe(ghId);
  });

  it('resolves explicit GH to the same canonical Ghana id', async () => {
    const resolved = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      resolveAuthorizedJurisdiction(store, tx, 'GH'),
    );

    expect(resolved).toBe(ghId);
  });

  it('rejects an explicitly unsupported country instead of falling back to Ghana', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        resolveAuthorizedJurisdiction(store, tx, 'NG'),
      ),
    ).rejects.toBeInstanceOf(UnsupportedJurisdictionError);
  });

  it('does not authorize Ghana for another tenant without an active entitlement', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgB }, (tx) =>
        resolveAuthorizedJurisdiction(store, tx, 'GH'),
      ),
    ).rejects.toBeInstanceOf(JurisdictionNotEntitledError);
  });
});
