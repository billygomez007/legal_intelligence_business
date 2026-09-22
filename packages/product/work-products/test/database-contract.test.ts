import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0001_work_products.sql', import.meta.url),
  'utf8',
);

it('is a substantive forward migration', () => {
  assert.ok(migration.length > 9000);
  assert.doesNotMatch(migration, /todo|placeholder|filled in by/i);
});

for (const table of [
  'work_products.work_products',
  'work_products.revisions',
  'work_products.revision_provenance',
  'work_products.reviews',
]) {
  it(`creates ${table}`, () => {
    assert.match(migration, new RegExp(`CREATE TABLE ${table.replace('.', '\\.')}`));
  });

  it(`enables tenant RLS for ${table}`, () => {
    assert.match(
      migration,
      new RegExp(`app\\.enable_tenant_rls\\([\\s\\S]*?${table.replace('.', '\\.')}`),
    );
  });
}

it('links each work product to an existing AI task', () => {
  assert.match(migration, /REFERENCES ai_tasks\.tasks \(organization_id, id\)/);
});

it('links optional matter context tenant-safely', () => {
  assert.match(migration, /REFERENCES workspace\.matters \(organization_id, id\)/);
});

it('makes revision numbers unique per work product', () => {
  assert.match(migration, /UNIQUE \(organization_id, work_product_id, revision_number\)/);
});

it('bounds stored content to one MiB', () => {
  assert.match(migration, /octet_length\(content\) <= 1048576/);
});

it('supports exactly the three Phase 7 provenance kinds', () => {
  for (const kind of [
    'matter_document_version',
    'knowledge_source_version',
    'corpus_document_version',
  ]) {
    assert.match(migration, new RegExp(kind));
  }
});

it('makes revision history immutable', () => {
  assert.match(migration, /work_product_revision_reject_update/);

  assert.match(migration, /work_product_revision_reject_delete/);
});

it('makes provenance history immutable', () => {
  assert.match(migration, /work_product_provenance_reject_update/);

  assert.match(migration, /work_product_provenance_reject_delete/);
});

it('makes human review history immutable', () => {
  assert.match(migration, /work_product_review_reject_update/);

  assert.match(migration, /work_product_review_reject_delete/);
});

it('does not grant Work Product tables to ingestion or dataops', () => {
  const executable = migration.replace(/--.*$/gm, '');

  assert.doesNotMatch(executable, /GRANT[\s\S]{0,200}legalintel_(?:ingest|dataops)/i);
});

it('gives immutable tables no UPDATE or DELETE application privilege', () => {
  for (const table of [
    'work_products.revisions',
    'work_products.revision_provenance',
    'work_products.reviews',
  ]) {
    const escaped = table.replace('.', '\\.');

    assert.match(
      migration,
      new RegExp(`GRANT SELECT, INSERT[\\s\\S]{0,80}ON ${escaped}[\\s\\S]{0,80}TO legalintel_app`),
    );
  }
});

it('defends current and submitted revision pointers', () => {
  assert.match(migration, /guard_revision_pointers/);

  assert.match(migration, /current_revision_mismatch/);

  assert.match(migration, /submitted_revision_mismatch/);
});

it('requires a reason for rejection', () => {
  assert.match(migration, /work_product_rejection_reason_required/);
});
