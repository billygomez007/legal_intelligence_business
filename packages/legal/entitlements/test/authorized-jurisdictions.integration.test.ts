import { platformMigrations } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { corpusMigrations } from '@legalintel/legal-corpus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { entitlementMigrations } from '../src/migrations';

describe('organization jurisdiction entitlements — PostgreSQL boundary', () => {
  let database!: TestDatabase;
  let admin!: TestDatabase['withAdmin'];

  beforeAll(async () => {
    database = await createTestDatabase({
      migrationSets: [platformMigrations, iamMigrations, corpusMigrations, entitlementMigrations],
    });

    admin = (fn) => database.withAdmin(fn);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('installs the policy table with tenant RLS enabled and forced', async () => {
    const result = await admin((client) =>
      client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`
        SELECT
          c.relrowsecurity,
          c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = 'policy'
          AND c.relname = 'organization_jurisdictions'
      `),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    expect(result.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('gives the runtime application SELECT but no mutation privilege', async () => {
    const result = await admin((client) =>
      client.query<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'legalintel_app',
            'policy.organization_jurisdictions',
            'SELECT'
          ) AS can_select,

          has_table_privilege(
            'legalintel_app',
            'policy.organization_jurisdictions',
            'INSERT'
          ) AS can_insert,

          has_table_privilege(
            'legalintel_app',
            'policy.organization_jurisdictions',
            'UPDATE'
          ) AS can_update,

          has_table_privilege(
            'legalintel_app',
            'policy.organization_jurisdictions',
            'DELETE'
          ) AS can_delete,

          has_table_privilege(
            'legalintel_app',
            'policy.organization_jurisdictions',
            'TRUNCATE'
          ) AS can_truncate
      `),
    );

    expect(result.rows).toEqual([
      {
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
      },
    ]);
  });

  it('references the canonical IAM organization and corpus jurisdiction registries', async () => {
    const result = await admin((client) =>
      client.query<{
        constraint_name: string;
        referenced_schema: string;
        referenced_table: string;
      }>(`
        SELECT
          con.conname AS constraint_name,
          referenced_namespace.nspname AS referenced_schema,
          referenced_class.relname AS referenced_table
        FROM pg_constraint con
        JOIN pg_class local_class
          ON local_class.oid = con.conrelid
        JOIN pg_namespace local_namespace
          ON local_namespace.oid = local_class.relnamespace
        JOIN pg_class referenced_class
          ON referenced_class.oid = con.confrelid
        JOIN pg_namespace referenced_namespace
          ON referenced_namespace.oid = referenced_class.relnamespace
        WHERE con.contype = 'f'
          AND local_namespace.nspname = 'policy'
          AND local_class.relname = 'organization_jurisdictions'
        ORDER BY con.conname
      `),
    );

    const references = result.rows.map((row) => `${row.referenced_schema}.${row.referenced_table}`);

    expect(references).toContain('iam.organizations');
    expect(references).toContain('corpus.jurisdictions');
    expect(references.filter((value) => value === 'iam.users')).toHaveLength(2);
  });

  it('enforces one logical entitlement per organization and jurisdiction', async () => {
    const result = await admin((client) =>
      client.query<{
        definition: string;
      }>(`
        SELECT pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class cls
          ON cls.oid = con.conrelid
        JOIN pg_namespace nsp
          ON nsp.oid = cls.relnamespace
        WHERE nsp.nspname = 'policy'
          AND cls.relname = 'organization_jurisdictions'
          AND con.contype = 'u'
      `),
    );

    expect(
      result.rows.some((row) =>
        /UNIQUE\s*\(organization_id,\s*jurisdiction_id\)/i.test(row.definition),
      ),
    ).toBe(true);
  });

  it('enforces the active/revoked lifecycle at the database boundary', async () => {
    const result = await admin((client) =>
      client.query<{
        constraint_name: string;
        definition: string;
      }>(`
        SELECT
          con.conname AS constraint_name,
          pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class cls
          ON cls.oid = con.conrelid
        JOIN pg_namespace nsp
          ON nsp.oid = cls.relnamespace
        WHERE nsp.nspname = 'policy'
          AND cls.relname = 'organization_jurisdictions'
          AND con.contype = 'c'
        ORDER BY con.conname
      `),
    );

    const sql = result.rows.map((row) => row.definition).join('\n');

    expect(sql).toMatch(/active/i);
    expect(sql).toMatch(/revoked/i);
    expect(sql).toMatch(/revoked_at/i);
  });
});
