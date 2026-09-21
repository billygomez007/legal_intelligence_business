import type { PermissionContribution } from '@legalintel/iam';

export const knowledgePermissions = {
  product: 'knowledge',

  permissions: [
    {
      key: 'knowledge:source:create',
      description: 'Create Firm Knowledge sources for the organization.',
    },
    {
      key: 'knowledge:source:read',
      description: 'Read Firm Knowledge sources for the organization.',
    },
    {
      key: 'knowledge:source:update',
      description: 'Update or archive Firm Knowledge sources for the organization.',
    },
    {
      key: 'knowledge:version:create',
      description: 'Create immutable versions for Firm Knowledge sources.',
    },
    {
      key: 'knowledge:version:read',
      description: 'Read Firm Knowledge source versions for the organization.',
    },
  ],

  orgRoleGrants: {
    owner: [
      'knowledge:source:create',
      'knowledge:source:read',
      'knowledge:source:update',
      'knowledge:version:create',
      'knowledge:version:read',
    ],

    admin: [
      'knowledge:source:create',
      'knowledge:source:read',
      'knowledge:source:update',
      'knowledge:version:create',
      'knowledge:version:read',
    ],

    member: ['knowledge:source:read', 'knowledge:version:read'],

    viewer: ['knowledge:source:read', 'knowledge:version:read'],
  },

  staffRoleGrants: {},
} satisfies PermissionContribution;
