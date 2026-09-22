import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, type MigrationSet } from '@legalintel/db';
import { iamMigrations } from '@legalintel/iam';
import { ingestionMigrations } from '@legalintel/legal-ingestion';
import { corpusMigrations } from '@legalintel/legal-corpus';
import { entitlementMigrations } from '@legalintel/entitlements';
import { workspaceMigrations } from '@legalintel/workspace';
import { knowledgeMigrations } from '@legalintel/knowledge';
import { matterDocumentMigrations } from '@legalintel/matter-documents';
import { aiTaskMigrations } from '@legalintel/ai-tasks';
import { workProductMigrations } from '@legalintel/work-products';
import { legalRetrievalMigrations } from '@legalintel/legal-retrieval';

/**
 * Every migration set in the repository, dependencies first. A set may reference objects
 * created by any set that appears before it. New packages that own tables add their set here.
 */
export const allMigrationSets: readonly MigrationSet[] = [
  platformMigrations,
  iamMigrations,
  auditMigrations,
  // Legal-domain sets follow the platform sets they depend on (corpus references iam.users).
  corpusMigrations,
  entitlementMigrations,
  workspaceMigrations,
  knowledgeMigrations,
  matterDocumentMigrations,
  aiTaskMigrations,
  workProductMigrations,
  legalRetrievalMigrations,
  ingestionMigrations,
];
