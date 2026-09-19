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
  | 'tenant-root-rls'
  | 'tenant-fk-composite'
  | 'non-tenant-references-tenant'
  | 'view-over-tenant-not-security-invoker'
  | 'materialized-view-over-tenant'
  | 'security-definer-without-search-path'
  | 'security-definer-search-path-order'
  | 'security-definer-public-execute'
  | 'security-definer-dynamic-sql'
  | 'security-definer-not-allowlisted'
  | 'security-definer-allowlist-stale'
  | 'security-definer-reads-tenant-table'
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
  /**
   * Tables that ARE the tenant (they have `id`, not `organization_id`), so the column-based
   * detection cannot see them. Each must have row-level security enabled and forced, and a
   * policy that references the tenant context. Tables that do not exist are skipped, so a
   * package's tests can pass the roots that exist in the schemas it migrates.
   */
  readonly tenantRootTables?: readonly string[];
  /**
   * The complete, reviewed inventory of SECURITY DEFINER functions, as `schema.name`. A definer
   * function runs with its owner's privileges, so adding one changes the trust model and must be
   * a deliberate, reviewed edit of this list. When given, any other definer is a violation, and
   * so is an entry that no longer exists (a stale list stops being a review).
   */
  readonly securityDefiners?: readonly string[];
  /**
   * Schemas whose definer functions may touch tenant tables: identity and tenancy bootstrap.
   * A definer function anywhere else (the public corpus, ingestion) must not, or it becomes a way
   * around row-level security. Default: iam and app.
   */
  readonly tenantAwareSchemas?: readonly string[];
}

export const DEFAULT_TENANT_ROOTS: readonly string[] = ['iam.organizations'];

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

async function checkTenantRoots(
  client: Client,
  roots: readonly string[],
  out: GuardrailViolation[],
): Promise<void> {
  for (const qualified of roots) {
    const result = await client.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      references_context: boolean;
    }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              EXISTS (
                SELECT 1 FROM pg_policy p
                 WHERE p.polrelid = c.oid
                   AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.current_org_id()%'
              ) AS references_context
         FROM pg_class c
        WHERE c.oid = to_regclass($1)`,
      [qualified],
    );
    const row = result.rows[0];
    if (row === undefined) continue; // Not migrated in this database.

    if (!row.relrowsecurity || !row.relforcerowsecurity) {
      out.push({
        rule: 'tenant-root-rls',
        object: qualified,
        detail: 'A tenant root table must have row level security enabled and forced.',
      });
    }
    if (!row.references_context) {
      out.push({
        rule: 'tenant-root-rls',
        object: qualified,
        detail:
          'No policy on this tenant root references app.current_org_id(), so it is not scoped to the current tenant.',
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

async function checkSecurityDefiner(
  client: Client,
  tables: readonly TenantTable[],
  options: GuardrailOptions,
  out: GuardrailViolation[],
): Promise<void> {
  const result = await client.query<{
    schema: string;
    qualified: string;
    proconfig: string[] | null;
    public_execute: boolean;
    body: string;
  }>(
    `SELECT n.nspname AS schema, n.nspname || '.' || p.proname AS qualified, p.proconfig,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
            p.prosrc AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname <> ALL($1::text[])
      ORDER BY 2`,
    [SYSTEM_SCHEMAS],
  );
  const tenantAware = new Set(options.tenantAwareSchemas ?? ['iam', 'app']);
  const allowed = options.securityDefiners === undefined ? null : new Set(options.securityDefiners);
  const seen = new Set<string>();

  for (const fn of result.rows) {
    seen.add(fn.qualified);
    const searchPath = (fn.proconfig ?? []).find((setting) => setting.startsWith('search_path='));
    if (searchPath === undefined) {
      out.push({
        rule: 'security-definer-without-search-path',
        object: fn.qualified,
        detail:
          'SECURITY DEFINER functions must pin search_path (SET search_path = ...), or a caller can shadow objects the function resolves.',
      });
    } else {
      const first = searchPath.slice('search_path='.length).split(',')[0]?.trim().replace(/"/g, '');
      if (first !== 'pg_catalog') {
        out.push({
          rule: 'security-definer-search-path-order',
          object: fn.qualified,
          detail: `search_path must list pg_catalog first (found "${searchPath}"), so nothing in a schema a caller can influence resolves before the built-ins.`,
        });
      }
    }
    if (fn.public_execute) {
      out.push({
        rule: 'security-definer-public-execute',
        object: fn.qualified,
        detail:
          'Every role can execute this SECURITY DEFINER function (PostgreSQL grants EXECUTE to PUBLIC by default). REVOKE ALL ... FROM PUBLIC, then grant it to the roles that need it.',
      });
    }
    if (/\bEXECUTE\b/i.test(fn.body)) {
      out.push({
        rule: 'security-definer-dynamic-sql',
        object: fn.qualified,
        detail:
          'A SECURITY DEFINER function builds SQL dynamically (EXECUTE). With its owner privileges, any interpolation flaw becomes privilege escalation. Use static SQL.',
      });
    }
    if (!tenantAware.has(fn.schema)) {
      for (const table of tables) {
        if (new RegExp(`\\b${table.qualified.replace(/\./g, '\\.')}\\b`).test(fn.body)) {
          out.push({
            rule: 'security-definer-reads-tenant-table',
            object: fn.qualified,
            detail: `Reaches tenant table ${table.qualified} with its owner's privileges, which bypasses row-level security. Only identity and tenancy functions (${[...tenantAware].join(', ')}) may.`,
          });
        }
      }
    }
    if (allowed !== null && !allowed.has(fn.qualified)) {
      out.push({
        rule: 'security-definer-not-allowlisted',
        object: fn.qualified,
        detail:
          'A SECURITY DEFINER function that is not in the reviewed inventory. Adding one changes the trust model: review it, then add it to the list on purpose.',
      });
    }
  }

  if (allowed !== null) {
    for (const name of allowed) {
      if (!seen.has(name)) {
        out.push({
          rule: 'security-definer-allowlist-stale',
          object: name,
          detail:
            'Listed as a SECURITY DEFINER function but it does not exist. Remove it from the inventory.',
        });
      }
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
  await checkTenantRoots(client, options.tenantRootTables ?? DEFAULT_TENANT_ROOTS, violations);
  await checkForeignKeys(client, tables, violations);
  await checkViews(client, tables, violations);
  await checkSecurityDefiner(client, tables, options, violations);
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
