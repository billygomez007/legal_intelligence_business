import { internalError } from '@legalintel/kernel';

import { ORG_ROLES, type OrgRole } from './roles';

/**
 * The permission catalog is composed from contributions, not hard-coded. The platform layer
 * contributes organization-level permissions; each product (legal research, a future product)
 * contributes its own and says which roles get them. That keeps this package reusable: it
 * knows nothing about cases, corpora or research.
 *
 * Permission strings contain at least two lowercase colon-delimited segments, such as
 * `matter:read`, `knowledge:source:read` or `matter-document:version:read`.
 * A permission on a resource that has an owner is
 * `scoped`, and is granted as `resource:action:own` or `resource:action:any`. No wildcards:
 * every grant is spelled out so a review can read exactly what a role can do.
 */
export interface PermissionDefinition {
  readonly key: string;
  readonly description: string;
  /** True if the resource has an owner, so grants are `:own` or `:any`. */
  readonly scoped?: boolean;
  /**
   * May an API key hold this permission? Defaults to false: keys are for programmatic access
   * to data, and administering members, keys or billing with a key is a privilege-escalation
   * path.
   */
  readonly apiKeyEligible?: boolean;
}

export interface PermissionContribution {
  readonly product: string;
  readonly permissions: readonly PermissionDefinition[];
  readonly orgRoleGrants: Readonly<Partial<Record<OrgRole, readonly string[]>>>;
  /** Platform-staff roles are contributed by products (e.g. a data reviewer). */
  readonly staffRoleGrants?: Readonly<Record<string, readonly string[]>>;
}

export interface CataloguedPermission extends PermissionDefinition {
  readonly product: string;
}

export interface PermissionCatalog {
  readonly permissions: ReadonlyMap<string, CataloguedPermission>;
  readonly orgRolePermissions: ReadonlyMap<OrgRole, ReadonlySet<string>>;
  readonly staffRolePermissions: ReadonlyMap<string, ReadonlySet<string>>;
  /** Grant strings (with scope suffix) that an API key may hold. */
  readonly apiKeyEligible: ReadonlySet<string>;
}

const KEY = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/;
const STAFF_ROLE = /^[a-z][a-z0-9_]{1,63}$/;

const invalid = (message: string) => internalError('authz.catalog_invalid', message);

/** Every grant string a definition can produce. */
export function grantsFor(definition: PermissionDefinition): string[] {
  return definition.scoped === true
    ? [`${definition.key}:own`, `${definition.key}:any`]
    : [definition.key];
}

export function composeCatalog(
  contributions: readonly PermissionContribution[],
): PermissionCatalog {
  const permissions = new Map<string, CataloguedPermission>();
  const grantable = new Map<string, CataloguedPermission>();

  for (const contribution of contributions) {
    for (const definition of contribution.permissions) {
      if (!KEY.test(definition.key)) {
        throw invalid(
          `Permission key "${definition.key}" must contain at least two lowercase colon-delimited segments using letters, digits, underscores or hyphens.`,
        );
      }
      const existing = permissions.get(definition.key);
      if (existing !== undefined) {
        throw invalid(
          `Permission "${definition.key}" is defined by both "${existing.product}" and "${contribution.product}".`,
        );
      }
      const catalogued = { ...definition, product: contribution.product };
      permissions.set(definition.key, catalogued);
      for (const grant of grantsFor(definition)) grantable.set(grant, catalogued);
    }
  }

  const checkGrants = (owner: string, grants: readonly string[]): Set<string> => {
    const result = new Set<string>();
    for (const grant of grants) {
      if (grant.includes('*')) {
        throw invalid(`${owner} uses the wildcard grant "${grant}". Grants must be explicit.`);
      }
      if (!grantable.has(grant)) {
        throw invalid(
          `${owner} is granted "${grant}", which is not a defined permission (scoped permissions must end in :own or :any; unscoped ones must not).`,
        );
      }
      if (result.has(grant)) throw invalid(`${owner} is granted "${grant}" twice.`);
      result.add(grant);
    }
    return result;
  };

  const orgRolePermissions = new Map<OrgRole, Set<string>>(
    ORG_ROLES.map((role) => [role, new Set()]),
  );
  const staffRolePermissions = new Map<string, Set<string>>();

  for (const contribution of contributions) {
    for (const [role, grants] of Object.entries(contribution.orgRoleGrants)) {
      const target = orgRolePermissions.get(role as OrgRole);
      if (target === undefined) {
        throw invalid(`Contribution "${contribution.product}" grants to unknown role "${role}".`);
      }
      for (const grant of checkGrants(`${contribution.product}/${role}`, grants)) target.add(grant);
    }
    for (const [role, grants] of Object.entries(contribution.staffRoleGrants ?? {})) {
      if (!STAFF_ROLE.test(role)) throw invalid(`Staff role "${role}" is not a valid role key.`);
      const target = staffRolePermissions.get(role) ?? new Set<string>();
      for (const grant of checkGrants(`${contribution.product}/staff:${role}`, grants))
        target.add(grant);
      staffRolePermissions.set(role, target);
    }
  }

  // Privilege inversion is the classic RBAC mistake: a "member" who can do something an
  // "admin" cannot. Require each role to be a superset of the next.
  for (let index = 0; index < ORG_ROLES.length - 1; index += 1) {
    const senior = ORG_ROLES[index];
    const junior = ORG_ROLES[index + 1];
    if (senior === undefined || junior === undefined) continue;
    const seniorGrants = orgRolePermissions.get(senior) ?? new Set<string>();
    // `x:any` implies `x:own`, so a senior role holding only `:any` is not missing `:own`.
    const covered = (grant: string) =>
      seniorGrants.has(grant) ||
      (grant.endsWith(':own') && seniorGrants.has(`${grant.slice(0, -':own'.length)}:any`));
    const missing = [...(orgRolePermissions.get(junior) ?? [])].filter((g) => !covered(g));
    if (missing.length > 0) {
      throw invalid(
        `Role "${junior}" holds ${missing.join(', ')}, which the more senior role "${senior}" lacks.`,
      );
    }
  }

  const apiKeyEligible = new Set<string>();
  for (const [grant, definition] of grantable) {
    if (definition.apiKeyEligible === true) apiKeyEligible.add(grant);
  }

  return { permissions, orgRolePermissions, staffRolePermissions, apiKeyEligible };
}
