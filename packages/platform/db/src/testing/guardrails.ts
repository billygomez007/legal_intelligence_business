import type { Client } from 'pg';

import { DB_ROLES, RUNTIME_ROLES } from '../roles';

/**
 * Structural checks over the PostgreSQL catalog. They exist because tenant isolation is
 * defeated far more often by an omission (a new table without a policy, a plain foreign key,
 * a view that runs as its owner) than by a mistake in an existing policy. Instead of
 * relying on review to notice what is *absent*, these fail the build.
 *
 * They run against the fully migrated schema, so any package that adds a migration is held
 * to the same rules.
 */

export type GuardrailRule =
  | 'tenant-org-column-not-null'
  | 'tenant-rls-enabled'
  | 'tenant-rls-forced'
  | 'tenant-restrictive-policy'
  | 'tenant-fk-composite'
  | 'non-tenant-references-tenant'
  | 'view-over-tenant-not-security-invoker'
  | 'materialized-view-over-tenant'
  | 'security-definer-without-search-path'
  | 'runtime-role-unsafe-attribute'
  | 'runtime-role-owns-relation'
  | 'runtime-role-can-create-in-schema'
  | 'runtime-role-dangerous-privilege';

export interface GuardrailViolation {
  readonly rule: GuardrailRule;
  readonly object: string;
  readonly detail: string;
}

export interface GuardrailOptions {
  /**
   * Tables that carry `organization_id` but are deliberately outside the standard policy,
   * with a written reason. Empty by default; every entry is a reviewable exception.
   */
  readonly tenantTableExemptions?: readonly string[];
  /**
   * Roles treated as runtime roles. Defaults to the application's. Overridable so the checks
   * themselves can be tested against a scratch role without altering shared cluster roles.
   */
  readonly runtimeRoleNames?: readonly string[];
}

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

interface TenantTable {
  schema: string;
  name: string;
  qualified: string;
  rowSecurity: boolean;
  forced: boolean;
  orgNotNull: boolean;
}

async function tenantTables(client: Client): Promise<TenantTable[]> {
  const result = await client.query<{
    nspname: string;
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
    attnotnull: boolean;
  }>(
    `SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, a.attnotnull
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attname = 'organization_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND c.relkind IN ('r', 'p')
        AND n.nspname <> ALL($1::text[])
        AND n.nspname NOT LIKE 'pg_toast%'
      ORDER BY n.nspname, c.relname`,
    [SYSTEM_SCHEMAS],
  );
  return result.rows.map((row) => ({
    schema: row.nspname,
    name: row.relname,
    qualified: `${row.nspname}.${row.relname}`,
    rowSecurity: row.relrowsecurity,
    forced: row.relforcerowsecurity,
    orgNotNull: row.attnotnull,
  }));
}

async function checkTenantTables(
  client: Client,
  tables: readonly TenantTable[],
  out: GuardrailViolation[],
): Promise<void> {
  const policies = await client.query<{
    nspname: string;
    relname: string;
    polname: string;
    polpermissive: boolean;
    polcmd: string;
    public_role: boolean;
    qual: string | null;
    check_expr: string | null;
  }>(
    `SELECT n.nspname, c.relname, p.polname, p.polpermissive, p.polcmd,
            (p.polroles = ARRAY[0::oid]) AS public_role,
            pg_get_expr(p.polqual, p.polrelid) AS qual,
            pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace`,
  );

  const isTenantExpression = (expression: string | null) =>
    expression !== null &&
    expression.includes('organization_id') &&
    expression.includes('app.current_org_id()');

  for (const table of tables) {
    if (!table.orgNotNull) {
      out.push({
        rule: 'tenant-org-column-not-null',
        object: table.qualified,
        detail:
          'organization_id must be NOT NULL: a NULL owner matches no policy and hides the row from everyone, or is treated as shared.',
      });
    }
    if (!table.rowSecurity) {
      out.push({
        rule: 'tenant-rls-enabled',
        object: table.qualified,
        detail:
          'Row level security is not enabled. Call app.enable_tenant_rls() in the migration that creates the table.',
      });
    }
    if (!table.forced) {
      out.push({
        rule: 'tenant-rls-forced',
        object: table.qualified,
        detail: 'Row level security is enabled but not FORCED, so the table owner bypasses it.',
      });
    }

    const tablePolicies = policies.rows.filter(
      (policy) => policy.nspname === table.schema && policy.relname === table.name,
    );
    const hasRestrictiveTenantPolicy = tablePolicies.some(
      (policy) =>
        !policy.polpermissive &&
        policy.polcmd === '*' &&
        policy.public_role &&
        isTenantExpression(policy.qual) &&
        isTenantExpression(policy.check_expr),
    );
    if (!hasRestrictiveTenantPolicy) {
      out.push({
        rule: 'tenant-restrictive-policy',
        object: table.qualified,
        detail:
          'Missing a RESTRICTIVE policy for ALL commands, TO PUBLIC, that matches organization_id against app.current_org_id() in both USING and WITH CHECK. ' +
          'A permissive-only policy can be widened by any later permissive policy.',
      });
    }
  }
}

async function checkForeignKeys(
  client: Client,
  tables: readonly TenantTable[],
  out: GuardrailViolation[],
): Promise<void> {
  const tenantNames = new Set(tables.map((table) => table.qualified));
  const result = await client.query<{
    conname: string;
    from_table: string;
    to_table: string;
    from_cols: string[];
    to_cols: string[];
  }>(
    `SELECT con.conname,
            fn.nspname || '.' || fc.relname AS from_table,
            tn.nspname || '.' || tc.relname AS to_table,
            -- ::text matters: attname is type "name", and the driver returns name[] as an
            -- unparsed string rather than a JavaScript array.
            (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS from_cols,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS to_cols
       FROM pg_constraint con
       JOIN pg_class fc ON fc.oid = con.conrelid
       JOIN pg_namespace fn ON fn.oid = fc.relnamespace
       JOIN pg_class tc ON tc.oid = con.confrelid
       JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      WHERE con.contype = 'f'
        AND fn.nspname <> ALL($1::text[])`,
    [SYSTEM_SCHEMAS],
  );

  for (const fk of result.rows) {
    const fromTenant = tenantNames.has(fk.from_table);
    const toTenant = tenantNames.has(fk.to_table);

    if (fromTenant && toTenant) {
      // Foreign-key checks bypass RLS. A plain (id) foreign key lets one tenant insert a
      // reference to another tenant's row and learn whether it exists from the error. A
      // composite key that includes organization_id makes the cross-tenant reference
      // structurally impossible.
      const fromIndex = fk.from_cols.indexOf('organization_id');
      const toIndex = fk.to_cols.indexOf('organization_id');
      if (fromIndex === -1 || toIndex === -1 || fromIndex !== toIndex) {
        out.push({
          rule: 'tenant-fk-composite',
          object: `${fk.from_table}.${fk.conname}`,
          detail: `Foreign key to tenant table ${fk.to_table} must include organization_id on both sides (found (${fk.from_cols.join(', ')}) -> (${fk.to_cols.join(', ')})).`,
        });
      }
    } else if (!fromTenant && toTenant) {
      out.push({
        rule: 'non-tenant-references-tenant',
        object: `${fk.from_table}.${fk.conname}`,
        detail: `Shared table ${fk.from_table} references tenant table ${fk.to_table}. Public data must never depend on private data.`,
      });
    }
  }
}

async function checkViews(
  client: Client,
  tables: readonly TenantTable[],
  out: GuardrailViolation[],
): Promise<void> {
  const tenantNames = new Set(tables.map((table) => table.qualified));

  const views = await client.query<{
    qualified: string;
    relkind: string;
    reloptions: string[] | null;
  }>(
    `SELECT n.nspname || '.' || c.relname AS qualified, c.relkind::text AS relkind, c.reloptions
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('v', 'm') AND n.nspname <> ALL($1::text[])`,
    [SYSTEM_SCHEMAS],
  );
  const dependencies = await client.query<{ view_name: string; depends_on: string }>(
    `SELECT DISTINCT vn.nspname || '.' || v.relname AS view_name,
                     tn.nspname || '.' || t.relname AS depends_on
       FROM pg_rewrite r
       JOIN pg_class v ON v.oid = r.ev_class
       JOIN pg_namespace vn ON vn.oid = v.relnamespace
       JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
                       AND d.refclassid = 'pg_class'::regclass
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE v.relkind IN ('v', 'm') AND t.oid <> v.oid`,
  );

  const graph = new Map<string, string[]>();
  for (const dependency of dependencies.rows) {
    graph.set(dependency.view_name, [
      ...(graph.get(dependency.view_name) ?? []),
      dependency.depends_on,
    ]);
  }

  // A view is "over tenant data" if it depends on a tenant table directly or through
  // another view.
  const dependsOnTenant = (name: string, seen = new Set<string>()): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    return (graph.get(name) ?? []).some(
      (target) => tenantNames.has(target) || dependsOnTenant(target, seen),
    );
  };

  for (const view of views.rows) {
    if (!dependsOnTenant(view.qualified)) continue;

    if (view.relkind === 'm') {
      out.push({
        rule: 'materialized-view-over-tenant',
        object: view.qualified,
        detail:
          "Materialized views cannot enforce row level security; they would expose one tenant's rows to another.",
      });
      continue;
    }

    // Without security_invoker a view runs with its owner's privileges, and the owner is
    // not subject to the tenant policies the caller would be.
    const invoker = (view.reloptions ?? []).some((option) =>
      /^security_invoker=(true|on)$/i.test(option),
    );
    if (!invoker) {
      out.push({
        rule: 'view-over-tenant-not-security-invoker',
        object: view.qualified,
        detail: 'A view over tenant data must be created WITH (security_invoker = true).',
      });
    }
  }
}

async function checkSecurityDefiner(client: Client, out: GuardrailViolation[]): Promise<void> {
  const result = await client.query<{ qualified: string; proconfig: string[] | null }>(
    `SELECT n.nspname || '.' || p.proname AS qualified, p.proconfig
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname <> ALL($1::text[])`,
    [SYSTEM_SCHEMAS],
  );
  for (const fn of result.rows) {
    const pinned = (fn.proconfig ?? []).some((setting) => setting.startsWith('search_path='));
    if (!pinned) {
      out.push({
        rule: 'security-definer-without-search-path',
        object: fn.qualified,
        detail:
          'SECURITY DEFINER functions must pin search_path (SET search_path = ...), or a caller can shadow objects the function resolves.',
      });
    }
  }
}

async function checkRuntimeRoles(
  client: Client,
  names: readonly string[],
  out: GuardrailViolation[],
): Promise<void> {
  const attributes = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
  }>(
    'SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ANY($1::text[])',
    [names],
  );
  for (const role of attributes.rows) {
    const bad = [
      role.rolsuper && 'SUPERUSER',
      role.rolbypassrls && 'BYPASSRLS',
      role.rolcreaterole && 'CREATEROLE',
      role.rolcreatedb && 'CREATEDB',
    ].filter((value): value is string => typeof value === 'string');
    if (bad.length > 0) {
      out.push({
        rule: 'runtime-role-unsafe-attribute',
        object: role.rolname,
        detail: `Runtime role has ${bad.join(', ')}.`,
      });
    }
  }

  const owned = await client.query<{ rolname: string; qualified: string }>(
    `SELECT r.rolname, n.nspname || '.' || c.relname AS qualified
       FROM pg_class c
       JOIN pg_roles r ON r.oid = c.relowner
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE r.rolname = ANY($1::text[]) AND n.nspname <> ALL($2::text[])`,
    [names, SYSTEM_SCHEMAS],
  );
  for (const row of owned.rows) {
    out.push({
      rule: 'runtime-role-owns-relation',
      object: row.qualified,
      detail: `Runtime role ${row.rolname} owns this relation. Owners can alter it and (without FORCE) bypass its policies.`,
    });
  }

  const create = await client.query<{ rolname: string; nspname: string }>(
    `SELECT r.rolname, n.nspname
       FROM pg_namespace n CROSS JOIN pg_roles r
      WHERE r.rolname = ANY($1::text[])
        AND n.nspname <> ALL($2::text[])
        AND n.nspname NOT LIKE 'pg_toast%'
        AND has_schema_privilege(r.oid, n.oid, 'CREATE')`,
    [names, SYSTEM_SCHEMAS],
  );
  for (const row of create.rows) {
    out.push({
      rule: 'runtime-role-can-create-in-schema',
      object: row.nspname,
      detail: `Runtime role ${row.rolname} can create objects in schema ${row.nspname}.`,
    });
  }

  // TRUNCATE is not subject to row level security: one tenant could empty every tenant's
  // rows. REFERENCES and TRIGGER let a role plant behaviour in tables it does not own.
  const dangerous = await client.query<{ rolname: string; qualified: string; privilege: string }>(
    `SELECT r.rolname, n.nspname || '.' || c.relname AS qualified, p.privilege
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN pg_roles r
       CROSS JOIN (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS p(privilege)
      WHERE c.relkind IN ('r', 'p')
        AND r.rolname = ANY($1::text[])
        AND n.nspname <> ALL($2::text[])
        AND has_table_privilege(r.oid, c.oid, p.privilege)`,
    [names, SYSTEM_SCHEMAS],
  );
  for (const row of dangerous.rows) {
    out.push({
      rule: 'runtime-role-dangerous-privilege',
      object: row.qualified,
      detail: `Runtime role ${row.rolname} has ${row.privilege} on this table.`,
    });
  }
}

export async function checkGuardrails(
  client: Client,
  options: GuardrailOptions = {},
): Promise<GuardrailViolation[]> {
  const violations: GuardrailViolation[] = [];
  const exempt = new Set(options.tenantTableExemptions ?? []);
  const tables = await tenantTables(client);

  // An exemption waives the policy requirement only. The table is still tenant data, so
  // references to it and views over it are still checked.
  await checkTenantTables(
    client,
    tables.filter((table) => !exempt.has(table.qualified)),
    violations,
  );
  await checkForeignKeys(client, tables, violations);
  await checkViews(client, tables, violations);
  await checkSecurityDefiner(client, violations);
  await checkRuntimeRoles(
    client,
    options.runtimeRoleNames ?? RUNTIME_ROLES.map((role) => DB_ROLES[role]),
    violations,
  );

  return violations;
}

export function formatViolations(violations: readonly GuardrailViolation[]): string {
  return violations.map((v) => `[${v.rule}] ${v.object}: ${v.detail}`).join('\n');
}
