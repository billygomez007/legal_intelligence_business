import { ORG_ROLES } from './roles';
import { grantsFor, type PermissionCatalog } from './catalog';

/**
 * Renders the catalog as a Markdown table. A test compares the committed document with this
 * output, so a change to who can do what cannot land without the reviewed diff in the docs.
 */
export function renderPermissionMatrix(catalog: PermissionCatalog, title: string): string {
  const staffRoles = [...catalog.staffRolePermissions.keys()].sort();
  const columns = [...ORG_ROLES, ...staffRoles.map((role) => `staff:${role}`), 'API key'];
  const mark = (value: boolean) => (value ? 'yes' : '');

  const rows: string[] = [];
  for (const definition of [...catalog.permissions.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    for (const grant of grantsFor(definition)) {
      const cells = [
        ...ORG_ROLES.map((role) => mark(catalog.orgRolePermissions.get(role)?.has(grant) ?? false)),
        ...staffRoles.map((role) =>
          mark(catalog.staffRolePermissions.get(role)?.has(grant) ?? false),
        ),
        mark(catalog.apiKeyEligible.has(grant)),
      ];
      rows.push(`| \`${grant}\` | ${definition.product} | ${cells.join(' | ')} |`);
    }
  }

  return [
    `# ${title}`,
    '',
    '<!-- Generated from code. Do not edit by hand; run `pnpm docs:permissions`. A test fails if this file is stale. -->',
    '',
    'Deny by default: a role can do only what is marked. `:own` applies to resources the caller owns; `:any` to all in the organization. "API key" marks permissions an API key may hold at all; a key is further limited to what its issuer can currently do.',
    '',
    `| Permission | Product | ${columns.join(' | ')} |`,
    `| --- | --- | ${columns.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
  ].join('\n');
}
