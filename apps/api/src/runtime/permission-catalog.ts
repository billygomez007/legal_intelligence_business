import { aiTaskPermissionContribution } from '@legalintel/ai-tasks';

import { composeCatalog, platformPermissions, type PermissionCatalog } from '@legalintel/iam';

import { knowledgePermissions } from '@legalintel/knowledge';

import { matterDocumentPermissionContribution } from '@legalintel/matter-documents';

import { workProductPermissionContribution } from '@legalintel/work-products';

import { workspacePermissions } from '@legalintel/workspace';

/**
 * One authoritative permission catalog for the Law Afrique API runtime.
 *
 * The API does not manufacture grants. IAM derives effective permissions
 * from this catalog plus CURRENT database membership/roles.
 */
export function createLawAfriquePermissionCatalog(): PermissionCatalog {
  return composeCatalog([
    platformPermissions,
    workspacePermissions,
    aiTaskPermissionContribution,
    knowledgePermissions,
    matterDocumentPermissionContribution,
    workProductPermissionContribution,
  ]);
}
