import { randomBytes } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkGuardrails,
  formatViolations,
  createTestDatabase,
  type GuardrailRule,
  type GuardrailViolation,
  type TestDatabase,
} from '../src/testing';

let clean: TestDatabase;
let defects: TestDatabase;

/**
 * Each block of DDL introduces exactly one kind of defect in its own schema. Superuser
 * creates them because some (ownership by the runtime role) cannot be arranged by the migrator.
 */
const DEFECTS = `
  CREATE SCHEMA g_ok;   CREATE SCHEMA g_a; CREATE SCHEMA g_b; CREATE SCHEMA g_c;
  CREATE SCHEMA g_d;    CREATE SCHEMA g_e; CREATE SCHEMA g_f; CREATE SCHEMA g_g;
  CREATE SCHEMA g_h;    CREATE SCHEMA g_i;

  -- Control: built the sanctioned way. Must produce no violation.
  CREATE TABLE g_ok.good (
    organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
    PRIMARY KEY (id), UNIQUE (organization_id, id));
  CALL app.enable_tenant_rls('g_ok.good');
  CREATE TABLE g_ok.good_child (
    organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
    good_id uuid NOT NULL, PRIMARY KEY (id),
    FOREIGN KEY (organization_id, good_id) REFERENCES g_ok.good (organization_id, id));
  CALL app.enable_tenant_rls('g_ok.good_child');
  CREATE VIEW g_ok.good_view WITH (security_invoker = true) AS SELECT * FROM g_ok.good;

  -- (a) tenant table with no row-level security at all
  CREATE TABLE g_a.no_rls (organization_id uuid NOT NULL, id uuid PRIMARY KEY);

  -- (b) enabled but not forced
  CREATE TABLE g_b.not_forced (organization_id uuid NOT NULL, id uuid PRIMARY KEY);
  ALTER TABLE g_b.not_forced ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON g_b.not_forced AS RESTRICTIVE FOR ALL TO PUBLIC
    USING (organization_id = (SELECT app.current_org_id()))
    WITH CHECK (organization_id = (SELECT app.current_org_id()));

  -- (c) permissive-only policy
  CREATE TABLE g_c.permissive_only (organization_id uuid NOT NULL, id uuid PRIMARY KEY);
  ALTER TABLE g_c.permissive_only ENABLE ROW LEVEL SECURITY;
  ALTER TABLE g_c.permissive_only FORCE ROW LEVEL SECURITY;
  CREATE POLICY only_own ON g_c.permissive_only AS PERMISSIVE FOR ALL TO legalintel_app
    USING (organization_id = (SELECT app.current_org_id()))
    WITH CHECK (organization_id = (SELECT app.current_org_id()));

  -- (c2) restrictive policy that covers only SELECT, leaving writes unprotected
  CREATE TABLE g_c.select_only (organization_id uuid NOT NULL, id uuid PRIMARY KEY);
  ALTER TABLE g_c.select_only ENABLE ROW LEVEL SECURITY;
  ALTER TABLE g_c.select_only FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON g_c.select_only AS RESTRICTIVE FOR SELECT TO PUBLIC
    USING (organization_id = (SELECT app.current_org_id()));

  -- (c3) restrictive policy that does not mention the tenant context
  CREATE TABLE g_c.wrong_predicate (organization_id uuid NOT NULL, id uuid PRIMARY KEY);
  ALTER TABLE g_c.wrong_predicate ENABLE ROW LEVEL SECURITY;
  ALTER TABLE g_c.wrong_predicate FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON g_c.wrong_predicate AS RESTRICTIVE FOR ALL TO PUBLIC
    USING (true) WITH CHECK (true);

  -- (d) plain foreign key between tenant tables, and a composite key that names the
  -- column on only one side of the pairing
  CREATE TABLE g_d.parent (
    organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
    PRIMARY KEY (id), UNIQUE (organization_id, id));
  CALL app.enable_tenant_rls('g_d.parent');
  CREATE TABLE g_d.child_plain (
    organization_id uuid NOT NULL, id uuid PRIMARY KEY,
    parent_id uuid NOT NULL REFERENCES g_d.parent (id));
  CALL app.enable_tenant_rls('g_d.child_plain');

  -- (e) shared (non-tenant) table depending on tenant data
  CREATE TABLE g_e.shared_ref (id uuid PRIMARY KEY, parent_id uuid REFERENCES g_d.parent (id));

  -- (f) views over tenant data
  CREATE VIEW g_f.bad_view AS SELECT * FROM g_d.parent;
  CREATE VIEW g_f.good_view WITH (security_invoker = true) AS SELECT * FROM g_d.parent;
  CREATE VIEW g_f.nested_bad_view AS SELECT * FROM g_f.good_view;
  CREATE MATERIALIZED VIEW g_f.matview AS SELECT * FROM g_d.parent;
  CREATE VIEW g_f.unrelated_view AS SELECT 1 AS n;

  -- (g) SECURITY DEFINER functions
  -- Each definer function below isolates one defect and is otherwise built the sanctioned way
  -- (pinned search_path, EXECUTE revoked from PUBLIC), so a rule firing is about that defect.
  CREATE FUNCTION g_g.definer_bad() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
  REVOKE ALL ON FUNCTION g_g.definer_bad() FROM PUBLIC;
  CREATE FUNCTION g_g.definer_good() RETURNS int LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog AS 'SELECT 1';
  REVOKE ALL ON FUNCTION g_g.definer_good() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION g_g.definer_good() TO legalintel_app;
  CREATE FUNCTION g_g.invoker() RETURNS int LANGUAGE sql AS 'SELECT 1';
  -- (g2) executable by every role: PostgreSQL's default, which is the defect
  CREATE FUNCTION g_g.definer_public() RETURNS int LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog AS 'SELECT 1';
  -- (g3) builds SQL dynamically
  CREATE FUNCTION g_g.definer_dynamic(p text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog AS $$ BEGIN EXECUTE 'SELECT ' || p; END $$;
  REVOKE ALL ON FUNCTION g_g.definer_dynamic(text) FROM PUBLIC;
  -- (g4) pinned, but a schema other than pg_catalog comes first
  CREATE FUNCTION g_g.definer_path_order() RETURNS int LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_catalog AS 'SELECT 1';
  REVOKE ALL ON FUNCTION g_g.definer_path_order() FROM PUBLIC;
  -- (g5) a public-data schema reaching into a tenant table with its owner's privileges
  CREATE FUNCTION g_g.definer_tenant() RETURNS bigint LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog AS 'SELECT count(*) FROM g_ok.good';
  REVOKE ALL ON FUNCTION g_g.definer_tenant() FROM PUBLIC;

  -- (h) runtime-role privileges
  CREATE TABLE g_h.truncatable (id int);
  GRANT TRUNCATE ON g_h.truncatable TO legalintel_app;
  CREATE TABLE g_h.triggerable (id int);
  GRANT TRIGGER ON g_h.triggerable TO legalintel_ingest;
  CREATE TABLE g_h.owned_by_runtime (id int);
  ALTER TABLE g_h.owned_by_runtime OWNER TO legalintel_dataops;
  GRANT CREATE ON SCHEMA g_h TO legalintel_app;
  CREATE TABLE g_h.safe (id int);
  GRANT SELECT, INSERT, UPDATE, DELETE ON g_h.safe TO legalintel_app;

  -- (j) tenant root tables: one without RLS, one with RLS but no tenant-scoped policy, one correct
  CREATE SCHEMA g_root;
  CREATE TABLE g_root.no_rls (id uuid PRIMARY KEY);
  CREATE TABLE g_root.no_policy (id uuid PRIMARY KEY);
  ALTER TABLE g_root.no_policy ENABLE ROW LEVEL SECURITY;
  ALTER TABLE g_root.no_policy FORCE ROW LEVEL SECURITY;
  CREATE POLICY open ON g_root.no_policy FOR SELECT TO legalintel_app USING (true);
  CREATE TABLE g_root.good (id uuid PRIMARY KEY);
  ALTER TABLE g_root.good ENABLE ROW LEVEL SECURITY;
  ALTER TABLE g_root.good FORCE ROW LEVEL SECURITY;
  CREATE POLICY scoped ON g_root.good FOR SELECT TO legalintel_app
    USING (id = (SELECT app.current_org_id()));

  -- (i) exempted tenant table
  CREATE TABLE g_i.exempt (organization_id uuid NOT NULL, id uuid PRIMARY KEY);
`;

beforeAll(async () => {
  [clean, defects] = await Promise.all([createTestDatabase(), createTestDatabase()]);
  await defects.withAdmin((client) => client.query(DEFECTS));
});

afterAll(async () => {
  await Promise.all([clean.dispose(), defects.dispose()]);
});

async function violations(
  database: TestDatabase,
  options?: Parameters<typeof checkGuardrails>[1],
): Promise<GuardrailViolation[]> {
  return database.withAdmin((client) => checkGuardrails(client, options));
}

const rulesFor = (all: readonly GuardrailViolation[], object: string): GuardrailRule[] =>
  all
    .filter((v) => v.object === object || v.object.startsWith(`${object}.`))
    .map((v) => v.rule)
    .sort();

describe('the real migrated schema', () => {
  it('has no guardrail violations', async () => {
    const found = await violations(clean);
    expect(found, formatViolations(found)).toEqual([]);
  });
});

describe('tenant table checks', () => {
  it('accept a table, foreign key and view built the sanctioned way', async () => {
    const found = await violations(defects);
    expect(rulesFor(found, 'g_ok.good')).toEqual([]);
    expect(rulesFor(found, 'g_ok.good_child')).toEqual([]);
    expect(rulesFor(found, 'g_ok.good_view')).toEqual([]);
  });

  it('flag a tenant table with no row-level security', async () => {
    expect(rulesFor(await violations(defects), 'g_a.no_rls')).toEqual([
      'tenant-restrictive-policy',
      'tenant-rls-enabled',
      'tenant-rls-forced',
    ]);
  });

  it('flag RLS that is enabled but not forced', async () => {
    expect(rulesFor(await violations(defects), 'g_b.not_forced')).toEqual(['tenant-rls-forced']);
  });

  it('flag a permissive-only policy design', async () => {
    expect(rulesFor(await violations(defects), 'g_c.permissive_only')).toEqual([
      'tenant-restrictive-policy',
    ]);
  });

  it('flag a restrictive policy that does not cover every command', async () => {
    expect(rulesFor(await violations(defects), 'g_c.select_only')).toEqual([
      'tenant-restrictive-policy',
    ]);
  });

  it('flag a restrictive policy that does not actually test the tenant', async () => {
    expect(rulesFor(await violations(defects), 'g_c.wrong_predicate')).toEqual([
      'tenant-restrictive-policy',
    ]);
  });

  it('honour a written exemption for the policy requirement only', async () => {
    expect(rulesFor(await violations(defects), 'g_i.exempt').length).toBeGreaterThan(0);
    expect(
      rulesFor(await violations(defects, { tenantTableExemptions: ['g_i.exempt'] }), 'g_i.exempt'),
    ).toEqual([]);
  });

  it('flag a nullable organization_id', async () => {
    await defects.withAdmin((client) =>
      client.query(
        `CREATE SCHEMA g_null; CREATE TABLE g_null.t (organization_id uuid, id uuid PRIMARY KEY)`,
      ),
    );
    expect(rulesFor(await violations(defects), 'g_null.t')).toContain('tenant-org-column-not-null');
  });
});

describe('tenant root checks', () => {
  const roots = ['g_root.no_rls', 'g_root.no_policy', 'g_root.good', 'g_root.does_not_exist'];

  it('flag a root table with no row-level security, and one whose policy ignores the tenant', async () => {
    const found = await violations(defects, { tenantRootTables: roots });
    expect(rulesFor(found, 'g_root.no_rls')).toEqual(['tenant-root-rls', 'tenant-root-rls']);
    expect(rulesFor(found, 'g_root.no_policy')).toEqual(['tenant-root-rls']);
  });

  it('accept a correctly scoped root and skip one that is not migrated', async () => {
    const found = await violations(defects, { tenantRootTables: roots });
    expect(rulesFor(found, 'g_root.good')).toEqual([]);
    expect(rulesFor(found, 'g_root.does_not_exist')).toEqual([]);
  });
});

describe('foreign key checks', () => {
  it('flag a plain foreign key between tenant tables', async () => {
    const found = await violations(defects);
    expect(rulesFor(found, 'g_d.child_plain')).toEqual(['tenant-fk-composite']);
  });

  it('flag a shared table that references tenant data', async () => {
    expect(rulesFor(await violations(defects), 'g_e.shared_ref')).toEqual([
      'non-tenant-references-tenant',
    ]);
  });
});

describe('view checks', () => {
  it('flag a view over tenant data that is not security_invoker', async () => {
    expect(rulesFor(await violations(defects), 'g_f.bad_view')).toEqual([
      'view-over-tenant-not-security-invoker',
    ]);
  });

  it('accept a security_invoker view', async () => {
    expect(rulesFor(await violations(defects), 'g_f.good_view')).toEqual([]);
  });

  it('follow dependencies through other views', async () => {
    expect(rulesFor(await violations(defects), 'g_f.nested_bad_view')).toEqual([
      'view-over-tenant-not-security-invoker',
    ]);
  });

  it('flag a materialized view over tenant data, which cannot enforce RLS', async () => {
    expect(rulesFor(await violations(defects), 'g_f.matview')).toEqual([
      'materialized-view-over-tenant',
    ]);
  });

  it('ignore views that do not touch tenant data', async () => {
    expect(rulesFor(await violations(defects), 'g_f.unrelated_view')).toEqual([]);
  });
});

describe('SECURITY DEFINER checks', () => {
  it('flag a definer function that does not pin search_path', async () => {
    expect(rulesFor(await violations(defects), 'g_g.definer_bad')).toEqual([
      'security-definer-without-search-path',
    ]);
  });

  it('accept a pinned definer function and an ordinary function', async () => {
    const found = await violations(defects);
    expect(rulesFor(found, 'g_g.definer_good')).toEqual([]);
    expect(rulesFor(found, 'g_g.invoker')).toEqual([]);
  });

  it('flag a definer function that every role can execute', async () => {
    expect(rulesFor(await violations(defects), 'g_g.definer_public')).toEqual([
      'security-definer-public-execute',
    ]);
  });

  it('flag a definer function that builds SQL dynamically', async () => {
    expect(rulesFor(await violations(defects), 'g_g.definer_dynamic')).toEqual([
      'security-definer-dynamic-sql',
    ]);
  });

  it('flag a search_path that does not list pg_catalog first', async () => {
    expect(rulesFor(await violations(defects), 'g_g.definer_path_order')).toEqual([
      'security-definer-search-path-order',
    ]);
  });

  it('flag a definer function outside identity and tenancy that reaches a tenant table', async () => {
    expect(rulesFor(await violations(defects), 'g_g.definer_tenant')).toEqual([
      'security-definer-reads-tenant-table',
    ]);
    // Naming the schema as tenant-aware is a deliberate, reviewable exception.
    const relaxed = await violations(defects, { tenantAwareSchemas: ['g_g'] });
    expect(rulesFor(relaxed, 'g_g.definer_tenant')).toEqual([]);
  });

  describe('the reviewed inventory', () => {
    const everything = [
      'g_g.definer_bad',
      'g_g.definer_good',
      'g_g.definer_public',
      'g_g.definer_dynamic',
      'g_g.definer_path_order',
      'g_g.definer_tenant',
    ];

    it('is not enforced unless one is supplied', async () => {
      const found = await violations(defects);
      expect(found.filter((v) => v.rule === 'security-definer-not-allowlisted')).toEqual([]);
    });

    it('flags every definer function that is not on the list', async () => {
      const found = await violations(defects, { securityDefiners: ['g_g.definer_good'] });
      const unlisted = found
        .filter((v) => v.rule === 'security-definer-not-allowlisted')
        .map((v) => v.object)
        .sort();
      expect(unlisted).toEqual(everything.filter((name) => name !== 'g_g.definer_good').sort());
    });

    it('flags a listed function that no longer exists, so the list cannot rot', async () => {
      const found = await violations(defects, {
        securityDefiners: [...everything, 'g_g.removed_long_ago'],
      });
      expect(found.filter((v) => v.rule === 'security-definer-allowlist-stale')).toEqual([
        expect.objectContaining({ object: 'g_g.removed_long_ago' }),
      ]);
      expect(found.filter((v) => v.rule === 'security-definer-not-allowlisted')).toEqual([]);
    });
  });
});

describe('runtime role checks', () => {
  it('flag TRUNCATE, which bypasses row-level security', async () => {
    expect(rulesFor(await violations(defects), 'g_h.truncatable')).toEqual([
      'runtime-role-dangerous-privilege',
    ]);
  });

  it('flag TRIGGER on any runtime role, not only the application role', async () => {
    expect(rulesFor(await violations(defects), 'g_h.triggerable')).toEqual([
      'runtime-role-dangerous-privilege',
    ]);
  });

  it('flag a runtime role that owns a relation', async () => {
    expect(rulesFor(await violations(defects), 'g_h.owned_by_runtime')).toContain(
      'runtime-role-owns-relation',
    );
  });

  it('flag a runtime role that can create objects in a schema', async () => {
    expect(rulesFor(await violations(defects), 'g_h')).toContain(
      'runtime-role-can-create-in-schema',
    );
  });

  it('accept ordinary data privileges', async () => {
    expect(rulesFor(await violations(defects), 'g_h.safe')).toEqual([]);
  });

  it('flag unsafe role attributes on a scratch role', async () => {
    const scratch = `lip_probe_${randomBytes(4).toString('hex')}`;
    await defects.withAdmin(async (client: Client) => {
      await client.query(`CREATE ROLE ${scratch} NOLOGIN BYPASSRLS CREATEDB`);
      try {
        const found = await checkGuardrails(client, { runtimeRoleNames: [scratch] });
        const forRole = found.filter((v) => v.object === scratch);
        expect(forRole.map((v) => v.rule)).toEqual(['runtime-role-unsafe-attribute']);
        expect(forRole[0]?.detail).toMatch(/BYPASSRLS/);
        expect(forRole[0]?.detail).toMatch(/CREATEDB/);
      } finally {
        await client.query(`DROP ROLE ${scratch}`);
      }
    });
  });
});
