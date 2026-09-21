import type { PermissionContribution } from '@legalintel/iam';

export const workspacePermissions = {
  product: 'workspace',

  permissions: [
    {
      key: 'client:create',
      description: 'Create clients for the organization.',
    },
    {
      key: 'client:read',
      description: 'Read clients for the organization.',
    },
    {
      key: 'client:update',
      description: 'Update clients for the organization.',
    },
    {
      key: 'matter:create',
      description: 'Create matters for the organization.',
    },
    {
      key: 'matter:read',
      description: 'Read matters for the organization.',
    },
    {
      key: 'matter:update',
      description: 'Update matters for the organization.',
    },
  ],

  orgRoleGrants: {
    owner: [
      'client:create',
      'client:read',
      'client:update',
      'matter:create',
      'matter:read',
      'matter:update',
    ],
    admin: [
      'client:create',
      'client:read',
      'client:update',
      'matter:create',
      'matter:read',
      'matter:update',
    ],
    member: [
      'client:create',
      'client:read',
      'client:update',
      'matter:create',
      'matter:read',
      'matter:update',
    ],
    viewer: ['client:read', 'matter:read'],
  },

  staffRoleGrants: {},
} satisfies PermissionContribution;
