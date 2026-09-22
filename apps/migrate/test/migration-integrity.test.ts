import { loadMigrationSet, type MigrationFile } from '@legalintel/db';
import { describe, expect, it } from 'vitest';

import { allMigrationSets } from '../src/sets';

/**
 * Guards on the migration files themselves, no database needed.
 *
 * Accepted migrations are history: an edit to one changes what a deployed database is claimed to
 * contain. The checksums below are the accepted files as they stood before the integrity
 * hardening, so an edit fails here, in review, and not on a database that already applied them.
 * The hardening lives in three forward migrations.
 */
const ACCEPTED: Readonly<Record<string, string>> = {
  'platform/0001_foundation.sql':
    'fa7143085a2e2a738ebee6ba4ae88037548efca95934c89d84c5c5a125e110e4',
  'iam/0001_iam.sql': 'fe86ab7be7566ae6fe18945a85b0ea126dd6235d0ec072c3b83a4ddec76d4b05',
  'audit/0001_audit.sql': '84a35e40a5b435652829ecf5a329108180134895e524f2f35ee20f82a1aae423',
  'corpus/0001_corpus.sql': '293b5f1931135323e2a8fd01bbcc6a86a25c1e9ef921dbf79ee2bfe58663c832',
  'corpus/0002_acquisition_rights.sql':
    '0d6afe57bd26276246bf7188d2b93ea81c31865222f54dbbbffdf911aee268bd',
  'corpus/0003_public_corpus_boundaries.sql':
    '1d576b6e0d9277d726fe3cce7f28fc3af0c4614714318bf3468737e258c151fe',
  'ingestion/0001_ingestion.sql':
    'd4e02e96c9536e196434727847d5e458e5d28ed10469dd4c91f6705e771302a8',
};

const FORWARD_MIGRATIONS = [
  'iam/0002_role_hierarchy_integrity.sql',
  'corpus/0004_version_integrity_and_publication_provenance.sql',
  'entitlements/0001_authorized_jurisdictions.sql',
  'workspace/0001_clients_and_matters.sql',
  'ingestion/0002_review_integrity.sql',
  'knowledge/0001_firm_knowledge.sql',
  'knowledge/0002_private_passages.sql',
  'matter_documents/0001_matter_documents.sql',
  'matter_documents/0002_private_passages.sql',
  'ai_tasks/0001_ai_tasks.sql',
  'work_products/0001_work_products.sql',
  'work_products/0002_text_constraints.sql',
  'legal_retrieval/0001_retrieval_sessions.sql',
];

async function everyMigration(): Promise<Map<string, MigrationFile>> {
  const all = new Map<string, MigrationFile>();
  for (const set of allMigrationSets) {
    for (const file of await loadMigrationSet(set)) all.set(`${set.name}/${file.filename}`, file);
  }
  return all;
}

describe('accepted migrations are never rewritten', () => {
  it.each(Object.entries(ACCEPTED))('%s is exactly as accepted', async (key, checksum) => {
    expect((await everyMigration()).get(key)?.checksum).toBe(checksum);
  });

  it('leaves no file that is neither accepted nor one of the approved forward migrations', async () => {
    const keys = [...(await everyMigration()).keys()].sort();
    expect(keys).toEqual([...Object.keys(ACCEPTED), ...FORWARD_MIGRATIONS].sort());
  });
});

describe('new migrations are forward migrations', () => {
  it('each follows the accepted versions of its own set, without a gap', async () => {
    const all = await everyMigration();
    const expectedVersions: Readonly<Record<string, number>> = {
      'iam/0002_role_hierarchy_integrity.sql': 2,
      'corpus/0004_version_integrity_and_publication_provenance.sql': 4,
      'entitlements/0001_authorized_jurisdictions.sql': 1,
      'workspace/0001_clients_and_matters.sql': 1,
      'knowledge/0002_private_passages.sql': 2,
      'matter_documents/0001_matter_documents.sql': 1,
      'matter_documents/0002_private_passages.sql': 2,
      'ai_tasks/0001_ai_tasks.sql': 1,
      'work_products/0001_work_products.sql': 1,
      'work_products/0002_text_constraints.sql': 2,
      'legal_retrieval/0001_retrieval_sessions.sql': 1,
      'ingestion/0002_review_integrity.sql': 2,
    };
    for (const [key, expected] of Object.entries(expectedVersions)) {
      expect(all.get(key)?.version, key).toBe(expected);
    }
    for (const set of allMigrationSets) {
      const versions = [...all.values()].filter((f) => f.set === set.name).map((f) => f.version);
      expect(versions, set.name).toEqual(versions.map((_, index) => index + 1));
    }
  });

  it('are real: not empty and not a placeholder', async () => {
    const all = await everyMigration();
    for (const key of FORWARD_MIGRATIONS) {
      const sql = all.get(key)?.sql ?? '';
      expect(sql.length, key).toBeGreaterThan(
        key === 'work_products/0002_text_constraints.sql' ? 500 : 2000,
      );
      expect(sql, key).not.toMatch(/filled in by|todo|placeholder/i);
    }
  });

  it('replace only the explicitly reviewed integrity constraints', async () => {
    const all = await everyMigration();
    const drops = FORWARD_MIGRATIONS.flatMap((key) => {
      const sql = (all.get(key)?.sql ?? '').replace(/--.*$/gm, '');
      return [
        ...sql.matchAll(
          /\bDROP\s+(?:TABLE|SCHEMA|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX|POLICY)\s+(?:IF\s+EXISTS\s+)?[\w.]+/gi,
        ),
      ].map((match) => `${key}: ${match[0].replace(/\s+/g, ' ')}`);
    });
    expect(drops).toEqual([
      'corpus/0004_version_integrity_and_publication_provenance.sql: DROP CONSTRAINT document_versions_supersedes_version_id_fkey',
      'work_products/0002_text_constraints.sql: DROP CONSTRAINT work_product_revision_content_nonempty',
      'work_products/0002_text_constraints.sql: DROP CONSTRAINT work_product_provenance_locator_valid',
      'work_products/0002_text_constraints.sql: DROP CONSTRAINT work_product_review_reason_valid',
    ]);
  });
});

describe('a migration set depends only on the sets before it', () => {
  /**
   * Set order is platform, iam, audit, corpus, ingestion. A schema-qualified reference (`iam.`,
   * `corpus.` ...) to a LATER set would apply on a database that had it and fail on one that did
   * not. Comments and string literals are ignored: they name things, they do not use them.
   */
  const FORBIDDEN: Readonly<Record<string, readonly string[]>> = {
    platform: ['iam', 'audit', 'corpus', 'graph', 'ingestion'],
    iam: ['audit', 'corpus', 'graph', 'ingestion'],
    audit: ['corpus', 'graph', 'ingestion'],
    corpus: ['ingestion'],
    work_products: ['ingestion'],
    ingestion: [],
  };

  const code = (sql: string) =>
    sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .replace(/'(?:[^']|'')*'/g, "''");

  it.each(Object.entries(FORBIDDEN))('%s never references %j', async (setName, forbidden) => {
    const all = await everyMigration();
    const offences: string[] = [];
    for (const file of all.values()) {
      if (file.set !== setName) continue;
      for (const schema of forbidden) {
        if (new RegExp(`\\b${schema}\\.[a-z_]`, 'i').test(code(file.sql))) {
          offences.push(`${file.set}/${file.filename} references ${schema}.*`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('the corpus, specifically, installs nothing that reads an ingestion table', async () => {
    const all = await everyMigration();
    for (const file of all.values()) {
      if (file.set === 'corpus')
        expect(code(file.sql), file.filename).not.toMatch(/\bingestion\b\s*\./i);
    }
  });

  it('the scan sees what it should: the ingestion set does reference the corpus', async () => {
    const all = await everyMigration();
    expect(code(all.get('ingestion/0002_review_integrity.sql')?.sql ?? '')).toMatch(
      /\bcorpus\.version_provenance_attestations/,
    );
    expect(
      code(all.get('corpus/0004_version_integrity_and_publication_provenance.sql')?.sql ?? ''),
    ).toMatch(/\biam\.users/);
  });
});
