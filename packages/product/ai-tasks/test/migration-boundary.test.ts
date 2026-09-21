import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/0001_ai_tasks.sql', import.meta.url)),
  'utf8',
);

describe('AI Tasks Phase 6A migration boundary', () => {
  it('owns only the AI task and append-only scope-revision tables', () => {
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS ai_tasks');
    expect(migration).toContain('CREATE TABLE ai_tasks.tasks');
    expect(migration).toContain('CREATE TABLE ai_tasks.task_scope_revisions');
  });

  it('forces tenant RLS on both Phase 6 tables', () => {
    expect(migration).toContain("CALL app.enable_tenant_rls('ai_tasks.tasks'::regclass)");

    expect(migration).toContain(
      "CALL app.enable_tenant_rls('ai_tasks.task_scope_revisions'::regclass)",
    );
  });

  it('gives tasks update rights but keeps scope revisions insert-and-read only', () => {
    expect(migration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE\s+ON\s+ai_tasks\.tasks\s+TO\s+legalintel_app;/s,
    );

    expect(migration).toMatch(
      /GRANT\s+SELECT,\s*INSERT\s+ON\s+ai_tasks\.task_scope_revisions\s+TO\s+legalintel_app;/s,
    );

    expect(migration).not.toMatch(/GRANT[^;]*DELETE[^;]*ai_tasks\./is);
  });

  it('makes scope revisions structurally matter-bound when a matter is selected', () => {
    expect(migration).toContain('FOREIGN KEY (organization_id, matter_id)');

    expect(migration).toContain('REFERENCES workspace.matters(organization_id, id)');

    expect(migration).toContain('ai_tasks_task_scope_revisions_matter_shape_check');
  });

  it('stores a canonical jurisdiction id but permits only the Ghana product code', () => {
    expect(migration).toContain('REFERENCES corpus.jurisdictions(id)');

    expect(migration).toContain("CHECK (jurisdiction_code = 'GH')");

    expect(migration).not.toMatch(/\bNigeria\b|['"]NG['"]/i);
  });

  it('makes the current scope pointer refer to an immutable scope revision', () => {
    expect(migration).toContain('ai_tasks_tasks_current_scope_fkey');

    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');

    expect(migration).toContain('ai_tasks.reject_scope_revision_mutation()');

    expect(migration).toContain('ai_tasks_scope_revision_reject_update');

    expect(migration).toContain('ai_tasks_scope_revision_reject_delete');
  });

  it('freezes ready definitions and cancelled tasks at the database boundary', () => {
    expect(migration).toContain('ai_tasks.guard_task_update()');

    expect(migration).toContain("OLD.status = 'ready'");

    expect(migration).toContain("OLD.status = 'cancelled'");

    expect(migration).toContain('ai_tasks.ready_definition_frozen');

    expect(migration).toContain('ai_tasks.cancelled_immutable');
  });

  it('does not structurally bind task scope to Firm Knowledge or Matter Documents rows', () => {
    expect(migration).not.toContain('REFERENCES knowledge.');

    expect(migration).not.toContain('REFERENCES matter_documents.');
  });

  it('does not introduce SECURITY DEFINER behavior', () => {
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});
