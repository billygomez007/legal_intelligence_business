import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../migrations/0001_authorized_jurisdictions.sql', import.meta.url),
);

describe('authorized jurisdictions migration boundary', () => {
  it('keeps tenant authorization policy outside the public corpus schema', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS policy');
    expect(sql).toContain('CREATE TABLE policy.organization_jurisdictions');
    expect(sql).not.toContain('CREATE TABLE corpus.organization_jurisdictions');
  });

  it('uses the canonical corpus jurisdiction registry', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('REFERENCES corpus.jurisdictions(id)');
    expect(sql).toContain('REFERENCES iam.organizations(id)');
  });

  it('installs the standard tenant RLS boundary', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain("CALL app.enable_tenant_rls('policy.organization_jurisdictions')");
    expect(sql).toContain('UNIQUE (organization_id, id)');
    expect(sql).toContain('UNIQUE (organization_id, jurisdiction_id)');
  });

  it('does not give the application mutation privileges', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('GRANT SELECT');
    expect(sql).not.toMatch(/GRANT\s+INSERT/i);
    expect(sql).not.toMatch(/GRANT\s+UPDATE/i);
    expect(sql).not.toMatch(/GRANT\s+DELETE/i);
    expect(sql).not.toMatch(/GRANT\s+TRUNCATE/i);
  });

  it('models active and revoked lifecycle states', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain("status IN ('active', 'revoked')");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("status = 'revoked'");
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('revoked_at IS NOT NULL');
  });
});
