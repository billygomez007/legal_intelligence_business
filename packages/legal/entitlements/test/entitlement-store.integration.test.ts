import { platformMigrations, withTenantTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { corpusMigrations, JurisdictionId } from '@legalintel/legal-corpus';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JurisdictionNotEntitledError, requireActiveJurisdictionEntitlement } from '../src';
import { PgEntitlementStore } from '../src/adapters/pg-entitlement-store';
import { entitlementMigrations } from '../src/migrations';

type TenantScope = Parameters<typeof withTenantTransaction>[1];

type OrganizationId = TenantScope['organizationId'];

describe('organization jurisdiction entitlement runtime — PostgreSQL', () => {
  let database!: TestDatabase;
  let pool!: DbPool;

  const store = new PgEntitlementStore();

  const orgA = randomUUID() as OrganizationId;

  const orgB = randomUUID() as OrganizationId;

  let jurisdictionId!: JurisdictionId;

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, corpusMigrations, entitlementMigrations],
    });

    pool = database.poolFor('app', {
      max: 8,
    });

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
          'Phase 2B Organization A',
          `phase2b-a-${orgA}`,
          orgB,
          'Phase 2B Organization B',
          `phase2b-b-${orgB}`,
        ],
      );

      const jurisdiction = await client.query<{
        id: string;
      }>(
        `INSERT INTO corpus.jurisdictions (
                 code,
                 name,
                 kind,
                 is_synthetic
               )
               VALUES ($1, $2, $3, true)
               RETURNING id`,
        [
          `ZZ-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
          'SYNTHETIC Phase 2B Jurisdiction',
          'country',
        ],
      );

      const row = jurisdiction.rows[0];

      if (!row) {
        throw new Error('Synthetic jurisdiction was not created.');
      }

      jurisdictionId = JurisdictionId.parse(row.id);

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
        [randomUUID(), orgA, jurisdictionId],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.dispose();
  });

  it('lists only the current organization entitlements', async () => {
    const seenByA = await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      (tx) => store.listOrganizationJurisdictions(tx),
    );

    const seenByB = await withTenantTransaction(
      pool,
      {
        organizationId: orgB,
      },
      (tx) => store.listOrganizationJurisdictions(tx),
    );

    expect(seenByA).toHaveLength(1);

    expect(seenByA[0]?.organizationId).toBe(orgA);

    expect(seenByA[0]?.jurisdictionId).toBe(jurisdictionId);

    expect(seenByB).toEqual([]);
  });

  it('resolves an active entitlement for the current organization', async () => {
    const active = await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      (tx) => requireActiveJurisdictionEntitlement(store, tx, jurisdictionId),
    );

    expect(active.organizationId).toBe(orgA);

    expect(active.jurisdictionId).toBe(jurisdictionId);

    expect(active.status).toBe('active');
  });

  it('does not expose another organization entitlement', async () => {
    const seen = await withTenantTransaction(
      pool,
      {
        organizationId: orgB,
      },
      (tx) => store.findActiveOrganizationJurisdiction(tx, jurisdictionId),
    );

    expect(seen).toBeNull();

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgB,
        },
        (tx) => requireActiveJurisdictionEntitlement(store, tx, jurisdictionId),
      ),
    ).rejects.toBeInstanceOf(JurisdictionNotEntitledError);
  });

  it('does not resolve a revoked entitlement', async () => {
    await database.withAdmin(async (client) => {
      await client.query(
        `UPDATE policy.organization_jurisdictions
               SET status = 'revoked',
                   revoked_at = clock_timestamp(),
                   revoked_by = NULL
               WHERE organization_id = $1
                 AND jurisdiction_id = $2`,
        [orgA, jurisdictionId],
      );
    });

    const seen = await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      (tx) => store.findActiveOrganizationJurisdiction(tx, jurisdictionId),
    );

    expect(seen).toBeNull();

    await expect(
      withTenantTransaction(
        pool,
        {
          organizationId: orgA,
        },
        (tx) => requireActiveJurisdictionEntitlement(store, tx, jurisdictionId),
      ),
    ).rejects.toBeInstanceOf(JurisdictionNotEntitledError);
  });

  it('resolves again after privileged reactivation without creating a duplicate', async () => {
    await database.withAdmin(async (client) => {
      await client.query(
        `UPDATE policy.organization_jurisdictions
               SET status = 'active',
                   granted_at = clock_timestamp(),
                   granted_by = NULL,
                   revoked_at = NULL,
                   revoked_by = NULL
               WHERE organization_id = $1
                 AND jurisdiction_id = $2`,
        [orgA, jurisdictionId],
      );
    });

    const active = await withTenantTransaction(
      pool,
      {
        organizationId: orgA,
      },
      (tx) => requireActiveJurisdictionEntitlement(store, tx, jurisdictionId),
    );

    expect(active.status).toBe('active');

    const count = await database.withAdmin((client) =>
      client.query<{
        n: string;
      }>(
        `SELECT count(*)::text AS n
                 FROM policy.organization_jurisdictions
                 WHERE organization_id = $1
                   AND jurisdiction_id = $2`,
        [orgA, jurisdictionId],
      ),
    );

    expect(count.rows).toEqual([
      {
        n: '1',
      },
    ]);
  });
});
