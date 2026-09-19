/**
 * Organization roles, ordered from most to least privileged. The catalog validates that each
 * role's permissions include everything the next role has, so a role can never accidentally
 * hold something a more senior role lacks.
 */
export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const isOrgRole = (value: unknown): value is OrgRole =>
  typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'removed'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ORGANIZATION_KINDS = ['individual', 'firm', 'corporate', 'institution'] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ORGANIZATION_STATUSES = ['active', 'suspended', 'closed'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];
