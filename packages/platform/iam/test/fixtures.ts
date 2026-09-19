import { composeCatalog, platformPermissions, type PermissionContribution } from '../src';

/**
 * A stand-in product, so these tests prove the engine works for any product and do not depend
 * on the legal domain (platform must not import legal).
 */
export const testProduct: PermissionContribution = {
  product: 'test',
  permissions: [
    { key: 'project:create', description: 'Create a project.' },
    { key: 'project:read', description: 'Read a project.', scoped: true, apiKeyEligible: true },
    { key: 'project:update', description: 'Update a project.', scoped: true },
    { key: 'corpus:read', description: 'Read the shared corpus.', apiKeyEligible: true },
    { key: 'corpus:review', description: 'Review corpus content.' },
    { key: 'corpus:publish', description: 'Publish corpus content.' },
  ],
  orgRoleGrants: {
    owner: ['project:create', 'project:read:any', 'project:update:any', 'corpus:read'],
    admin: ['project:create', 'project:read:any', 'project:update:any', 'corpus:read'],
    member: ['project:create', 'project:read:own', 'project:update:own', 'corpus:read'],
    viewer: ['project:read:own', 'corpus:read'],
  },
  staffRoleGrants: {
    data_reviewer: ['corpus:review'],
    data_publisher: ['corpus:publish'],
  },
};

export const catalog = composeCatalog([platformPermissions, testProduct]);
