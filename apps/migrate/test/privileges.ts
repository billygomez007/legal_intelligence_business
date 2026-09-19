import type { TestDatabase } from '@legalintel/db/testing';

type AdminClient = Parameters<Parameters<TestDatabase['withAdmin']>[0]>[0];

/**
 * What each runtime role can do, read straight from the catalog: table, column, function and
 * schema privileges. Rendered into docs/architecture/database-privileges.md so that any change
 * to a role's reach shows up as a reviewed diff instead of a line in a migration.
 */
interface Row {
  grantee: string;
  object: string;
  kind: string;
  privilege: string;
}

const ROLES = ['legalintel_app', 'legalintel_ingest', 'legalintel_dataops'];

export async function queryPrivileges(client: AdminClient): Promise<Row[]> {
  const result = await client.query<Row>(
    `SELECT grantee, object, kind, privilege FROM (
       SELECT r.rolname AS grantee, n.nspname || '.' || c.relname AS object,
              'table' AS kind, a.privilege_type AS privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE c.relkind IN ('r', 'p', 'v') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       UNION ALL
       SELECT r.rolname, n.nspname || '.' || c.relname || '.' || att.attname, 'column', a.privilege_type
         FROM pg_attribute att
         JOIN pg_class c ON c.oid = att.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(att.attacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE att.attacl IS NOT NULL AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       UNION ALL
       SELECT r.rolname, n.nspname || '.' || p.proname || '()', 'function', a.privilege_type
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(p.proacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       UNION ALL
       SELECT r.rolname, n.nspname, 'schema', a.privilege_type
         FROM pg_namespace n
         CROSS JOIN LATERAL aclexplode(n.nspacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'public')
     ) p
     WHERE grantee = ANY($1::text[])
     ORDER BY grantee, kind, object, privilege`,
    [ROLES],
  );
  return result.rows;
}

export function renderPrivilegeDocument(rows: readonly Row[]): string {
  const lines: string[] = [
    '# Database privileges',
    '',
    '<!-- Generated from the migrated schema. Do not edit by hand; run `UPDATE_DOCS=1 pnpm test:integration`. A test fails if this file is stale. -->',
    '',
    'What each runtime database role may do, read from the catalog after all migrations. Tenant tables additionally apply row-level security (see ADR-0004): a privilege here is the ceiling, RLS narrows it to the current organization. `legalintel_migrator` owns every object and is not listed; it belongs to the deploy pipeline only.',
    '',
    'Reviewing a migration? A change to this file is a change to what a role can do.',
    '',
  ];
  for (const role of ROLES) {
    lines.push(`## ${role}`, '');
    const mine = rows.filter((row) => row.grantee === role);
    if (mine.length === 0) {
      lines.push('No privileges.', '');
      continue;
    }
    for (const kind of ['schema', 'table', 'column', 'function']) {
      const ofKind = mine.filter((row) => row.kind === kind);
      if (ofKind.length === 0) continue;
      lines.push(`### ${kind}`, '', '| Object | Privileges |', '| --- | --- |');
      const byObject = new Map<string, string[]>();
      for (const row of ofKind)
        byObject.set(row.object, [...(byObject.get(row.object) ?? []), row.privilege]);
      for (const [object, privileges] of byObject) {
        lines.push(`| \`${object}\` | ${privileges.sort().join(', ')} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
