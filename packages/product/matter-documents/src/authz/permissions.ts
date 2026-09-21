import type { PermissionContribution } from '@legalintel/iam';

export const matterDocumentPermissionKeys = [
  'matter-document:create',
  'matter-document:read',
  'matter-document:update',
  'matter-document:version:create',
  'matter-document:version:read',
] as const;

export const matterDocumentPermissionContribution = {
  product: 'matter-documents',

  permissions: [
    {
      key: 'matter-document:create',
      description: 'Create private documents attached to matters.',
    },
    {
      key: 'matter-document:read',
      description: 'Read private documents attached to matters.',
    },
    {
      key: 'matter-document:update',
      description: 'Update or archive private matter documents.',
    },
    {
      key: 'matter-document:version:create',
      description: 'Create immutable versions of private matter documents.',
    },
    {
      key: 'matter-document:version:read',
      description: 'Read immutable versions of private matter documents.',
    },
  ],

  orgRoleGrants: {
    owner: [
      'matter-document:create',
      'matter-document:read',
      'matter-document:update',
      'matter-document:version:create',
      'matter-document:version:read',
    ],

    admin: [
      'matter-document:create',
      'matter-document:read',
      'matter-document:update',
      'matter-document:version:create',
      'matter-document:version:read',
    ],

    member: [
      'matter-document:create',
      'matter-document:read',
      'matter-document:update',
      'matter-document:version:create',
      'matter-document:version:read',
    ],

    viewer: ['matter-document:read', 'matter-document:version:read'],
  },

  staffRoleGrants: {},
} satisfies PermissionContribution;
