/**
 * Organization product/content entitlements.
 *
 * Entitlements answer what an organization is authorized to use.
 * They remain separate from IAM permissions and legal-source content rights.
 *
 * Runtime entitlement resolution is intentionally deferred to Phase 2B.
 */
export {};

export { entitlementMigrations } from './migrations.js';

export * from './domain/jurisdiction.js';
export * from './domain/entitlement.js';
export * from './ports/entitlement-store.js';
export * from './adapters/pg-entitlement-store.js';
export * from './application/resolve-entitlement.js';
