import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, type MigrationSet } from '@legalintel/db';
import { iamMigrations } from '@legalintel/iam';

/**
 * Every migration set in the repository, dependencies first. A set may reference objects
 * created by any set that appears before it. New packages that own tables add their set here.
 */
export const allMigrationSets: readonly MigrationSet[] = [
  platformMigrations,
  iamMigrations,
  auditMigrations,
];
