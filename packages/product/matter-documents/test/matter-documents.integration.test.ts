import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { platformMigrations } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import { iamMigrations } from '@legalintel/iam';
import { corpusMigrations } from '@legalintel/legal-corpus';
import { workspaceMigrations } from '@legalintel/workspace';

import { matterDocumentMigrations } from '../src';

const discoveredTables = ['matter_documents.documents', 'matter_documents.document_versions'];

describe('Matter Documents PostgreSQL boundary', () => {
  let database: TestDatabase;
  let databaseInitialized = false;

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
  });

  afterAll(async () => {
    if (databaseInitialized) {
      await database.dispose();
    }
  });

  it('creates the Matter Documents tables declared by the migration', async () => {
    expect(discoveredTables.length).toBeGreaterThanOrEqual(2);

    const rows = await database.withAdmin((client) =>
      client.query<{
        schema_name: string;
        table_name: string;
      }>(
        `SELECT schemaname AS schema_name, tablename AS table_name
           FROM pg_tables
          WHERE schemaname = 'matter_documents'
          ORDER BY tablename`,
      ),
    );

    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('forces RLS on every Matter Documents table', async () => {
    const rows = await database.withAdmin((client) =>
      client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname,
                c.relrowsecurity,
                c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'matter_documents'
            AND c.relkind = 'r'
          ORDER BY c.relname`,
      ),
    );

    expect(rows.rows.length).toBeGreaterThanOrEqual(2);

    for (const row of rows.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('does not grant DELETE on Matter Documents tables to legalintel_app', async () => {
    const rows = await database.withAdmin((client) =>
      client.query<{
        table_name: string;
        may_delete: boolean;
      }>(
        `SELECT c.relname AS table_name,
                has_table_privilege(
                  'legalintel_app',
                  quote_ident(n.nspname) || '.' || quote_ident(c.relname),
                  'DELETE'
                ) AS may_delete
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'matter_documents'
            AND c.relkind = 'r'
          ORDER BY c.relname`,
      ),
    );

    expect(rows.rows.length).toBeGreaterThanOrEqual(2);

    for (const row of rows.rows) {
      expect(row.may_delete).toBe(false);
    }
  });

  it('keeps document-version rows immutable to legalintel_app', async () => {
    const rows = await database.withAdmin((client) =>
      client.query<{
        table_name: string;
        may_update: boolean;
        may_delete: boolean;
      }>(
        `SELECT c.relname AS table_name,
                has_table_privilege(
                  'legalintel_app',
                  quote_ident(n.nspname) || '.' || quote_ident(c.relname),
                  'UPDATE'
                ) AS may_update,
                has_table_privilege(
                  'legalintel_app',
                  quote_ident(n.nspname) || '.' || quote_ident(c.relname),
                  'DELETE'
                ) AS may_delete
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'matter_documents'
            AND c.relkind = 'r'
            AND c.relname ILIKE '%version%'
          ORDER BY c.relname`,
      ),
    );

    expect(rows.rows.length).toBeGreaterThanOrEqual(1);

    for (const row of rows.rows) {
      expect(row.may_update).toBe(false);
      expect(row.may_delete).toBe(false);
    }
  });

  it('structurally references workspace matters', async () => {
    const rows = await database.withAdmin((client) =>
      client.query<{
        source_table: string;
        target_schema: string;
        target_table: string;
      }>(
        `SELECT source.relname AS source_table,
                target_ns.nspname AS target_schema,
                target.relname AS target_table
           FROM pg_constraint fk
           JOIN pg_class source ON source.oid = fk.conrelid
           JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
           JOIN pg_class target ON target.oid = fk.confrelid
           JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
          WHERE fk.contype = 'f'
            AND source_ns.nspname = 'matter_documents'
            AND target_ns.nspname = 'workspace'
            AND target.relname = 'matters'`,
      ),
    );

    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('does not structurally reference the public legal corpus', async () => {
    const rows = await database.withAdmin((client) =>
      client.query<{
        target_schema: string;
      }>(
        `SELECT target_ns.nspname AS target_schema
           FROM pg_constraint fk
           JOIN pg_class source ON source.oid = fk.conrelid
           JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
           JOIN pg_class target ON target.oid = fk.confrelid
           JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
          WHERE fk.contype = 'f'
            AND source_ns.nspname = 'matter_documents'
            AND target_ns.nspname = 'corpus'`,
      ),
    );

    expect(rows.rows).toHaveLength(0);
  });

  it('does not structurally reference Firm Knowledge', async () => {
    const rows = await database.withAdmin((client) =>
      client.query<{
        target_schema: string;
      }>(
        `SELECT target_ns.nspname AS target_schema
           FROM pg_constraint fk
           JOIN pg_class source ON source.oid = fk.conrelid
           JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
           JOIN pg_class target ON target.oid = fk.confrelid
           JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
          WHERE fk.contype = 'f'
            AND source_ns.nspname = 'matter_documents'
            AND target_ns.nspname = 'knowledge'`,
      ),
    );

    expect(rows.rows).toHaveLength(0);
  });
});
