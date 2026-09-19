import type { PermissionContribution } from './catalog';

/**
 * Organization administration. Product-agnostic: applies to every product built on this
 * platform. Nothing here is grantable to an API key.
 */
export const platformPermissions: PermissionContribution = {
  product: 'platform',
  permissions: [
    { key: 'organization:read', description: 'View the organization profile.' },
    { key: 'organization:update', description: 'Rename the organization.' },
    { key: 'member:read', description: 'View the organization’s members and their roles.' },
    { key: 'member:invite', description: 'Add members to the organization.' },
    { key: 'member:remove', description: 'Suspend or remove members.' },
    {
      key: 'member:assign_role',
      description: 'Grant or revoke roles (see role-assignment rules).',
    },
    { key: 'api_key:read', description: 'List the organization’s API keys.' },
    { key: 'api_key:create', description: 'Issue API keys.' },
    { key: 'api_key:revoke', description: 'Revoke API keys.' },
    { key: 'audit:read', description: 'Read the organization’s audit log.' },
    { key: 'billing:manage', description: 'Manage subscription and payment details.' },
  ],
  orgRoleGrants: {
    owner: [
      'organization:read',
      'organization:update',
      'member:read',
      'member:invite',
      'member:remove',
      'member:assign_role',
      'api_key:read',
      'api_key:create',
      'api_key:revoke',
      'audit:read',
      'billing:manage',
    ],
    admin: [
      'organization:read',
      'organization:update',
      'member:read',
      'member:invite',
      'member:remove',
      'member:assign_role',
      'api_key:read',
      'api_key:create',
      'api_key:revoke',
      'audit:read',
    ],
    member: ['organization:read', 'member:read'],
    viewer: ['organization:read', 'member:read'],
  },
};
