import type { PermissionContribution } from '@legalintel/iam';
export const ingestionPermissions: PermissionContribution = {
  product: 'legal_ingestion',
  permissions: [
    { key: 'ingestion:request', description: 'Request approved public-corpus ingestion.' },
    { key: 'ingestion:inspect', description: 'Inspect protected ingestion review packets.' },
    { key: 'corpus:review', description: 'Approve or reject an ingestion review task.' },
    {
      key: 'corpus:publish',
      description: 'Publish approved corpus versions through a separate action.',
    },
  ],
  orgRoleGrants: {},
  staffRoleGrants: {
    ingestion_operator: ['ingestion:request'],
    data_reviewer: ['ingestion:inspect', 'corpus:review'],
    data_publisher: ['corpus:publish'],
  },
};
