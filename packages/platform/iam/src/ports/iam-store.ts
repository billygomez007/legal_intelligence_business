import type { ApiKeyId, OrganizationId, UserId } from '@legalintel/kernel';

import type {
  MembershipStatus,
  OrganizationKind,
  OrganizationStatus,
  OrgRole,
} from '../domain/roles';

/**
 * Mirrors pg's `QueryResultRow`. Declared here so `Tx` from @legalintel/db is assignable to
 * `StoreTx` without this port importing the database driver (ports are pure).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match pg's row type exactly for assignability
export type StoreRow = Record<string, any>;

/**
 * A transaction handle. Structurally identical to `Tx` from @legalintel/db, declared here so
 * this port does not depend on the database package.
 */
export interface StoreTx {
  // `R` appears once because it mirrors pg's signature; callers choose the row shape.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  query<R extends StoreRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface OrganizationSummary {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly kind: OrganizationKind;
  readonly status: OrganizationStatus;
}

export interface MembershipRecord {
  readonly status: MembershipStatus;
  readonly roles: readonly OrgRole[];
}

export interface MemberSummary extends MembershipRecord {
  readonly userId: UserId;
}

export interface ApiKeyRecord {
  readonly id: ApiKeyId;
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly secretHash: Buffer;
  readonly lastFour: string;
  readonly scopes: readonly string[];
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
}

export type NewApiKey = Pick<
  ApiKeyRecord,
  'id' | 'name' | 'secretHash' | 'lastFour' | 'scopes' | 'createdBy' | 'expiresAt'
>;

/**
 * Persistence for identity and tenancy. Every method states which transaction context it
 * requires: `public` (withPublicTransaction), `user` (withUserTransaction) or `tenant`
 * (withTenantTransaction). Using the wrong one fails closed (no rows, or a refusal).
 */
export interface IamStore {
  /** public: create the user on first sign-in, or return the existing one for this identity. */
  provisionUser(
    tx: StoreTx,
    input: { provider: string; subject: string; email: string; displayName: string },
  ): Promise<UserId>;
  /** public: identity -> active user, or null. */
  resolveIdentity(tx: StoreTx, provider: string, subject: string): Promise<UserId | null>;

  /** user: create an organization owned by the calling user. */
  createOrganization(
    tx: StoreTx,
    input: { name: string; slug: string; kind: OrganizationKind },
  ): Promise<OrganizationId>;
  /** user: the organizations the calling user is an active member of. */
  listMyOrganizations(tx: StoreTx): Promise<OrganizationSummary[]>;

  /** tenant: the current organization. */
  loadOrganization(tx: StoreTx): Promise<OrganizationSummary | null>;
  loadMembership(tx: StoreTx, userId: UserId): Promise<MembershipRecord | null>;
  listMembers(tx: StoreTx): Promise<MemberSummary[]>;
  addMember(tx: StoreTx, userId: UserId, status?: MembershipStatus): Promise<void>;
  setMemberStatus(tx: StoreTx, userId: UserId, status: MembershipStatus): Promise<void>;
  assignRole(tx: StoreTx, userId: UserId, role: OrgRole, grantedBy: UserId): Promise<void>;
  revokeRole(tx: StoreTx, userId: UserId, role: OrgRole): Promise<void>;

  insertApiKey(tx: StoreTx, key: NewApiKey): Promise<void>;
  findApiKey(tx: StoreTx, keyId: ApiKeyId): Promise<ApiKeyRecord | null>;
  listApiKeys(tx: StoreTx): Promise<Omit<ApiKeyRecord, 'secretHash'>[]>;
  revokeApiKey(tx: StoreTx, keyId: ApiKeyId): Promise<void>;
  /** Records use, at most once every few minutes per key, to avoid a write per request. */
  touchApiKey(tx: StoreTx, keyId: ApiKeyId): Promise<void>;
}
