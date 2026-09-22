import type { PermissionContribution } from '@legalintel/iam';

export const workProductPermissionKeys = [
  'work_product:create',
  'work_product:read',
  'work_product:revise',
  'work_product:submit',
  'work_product:approve',
  'work_product:reject',
  'work_product:archive',
] as const;

export type WorkProductPermission = (typeof workProductPermissionKeys)[number];

export const workProductPermissionContribution = {
  product: 'work-products',

  permissions: workProductPermissionKeys.map((key) => ({
    key,
    description: `Perform ${key} within the organization.`,
    apiKeyEligible: false,
  })),

  orgRoleGrants: {
    owner: [...workProductPermissionKeys],
    admin: [...workProductPermissionKeys],

    member: [
      'work_product:create',
      'work_product:read',
      'work_product:revise',
      'work_product:submit',
    ],

    viewer: ['work_product:read'],
  },

  staffRoleGrants: {},
} satisfies PermissionContribution;
