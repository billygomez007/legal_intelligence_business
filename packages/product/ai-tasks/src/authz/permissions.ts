import type { PermissionContribution } from '@legalintel/iam';

export const aiTaskPermissionKeys = [
  'ai_task:create',
  'ai_task:read',
  'ai_task:update',
  'ai_task:transition',
] as const;

export const aiTaskPermissionContribution = {
  product: 'ai-tasks',

  permissions: [
    {
      key: 'ai_task:create',
      description: 'Create AI Employee tasks for the organization.',
    },
    {
      key: 'ai_task:read',
      description: 'Read AI Employee tasks and their selected knowledge scopes.',
    },
    {
      key: 'ai_task:update',
      description: 'Update draft AI Employee task definitions and knowledge scopes.',
    },
    {
      key: 'ai_task:transition',
      description: 'Mark AI Employee tasks ready or cancel them.',
    },
  ],

  orgRoleGrants: {
    owner: ['ai_task:create', 'ai_task:read', 'ai_task:update', 'ai_task:transition'],

    admin: ['ai_task:create', 'ai_task:read', 'ai_task:update', 'ai_task:transition'],

    member: ['ai_task:create', 'ai_task:read', 'ai_task:update', 'ai_task:transition'],

    viewer: ['ai_task:read'],
  },

  staffRoleGrants: {},
} satisfies PermissionContribution;
