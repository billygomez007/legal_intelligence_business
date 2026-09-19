import {
  ApiKeyId,
  OrganizationId,
  UserId,
  conflict,
  forbidden,
  notFound,
  preconditionFailed,
  validationError,
} from '@legalintel/kernel';

import { isOrgRole, type MembershipStatus, type OrgRole } from '../domain/roles';
import type {
  ApiKeyRecord,
  IamStore,
  MemberSummary,
  OrganizationSummary,
  StoreTx,
} from '../ports/iam-store';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  hint?: unknown;
}

const isPgError = (error: unknown): error is PgErrorLike =>
  typeof error === 'object' && error !== null && 'code' in error;

/**
 * Translates database errors into the platform's typed errors. Driver messages can quote
 * table names, constraint names and values, so they must never reach a caller; we surface a
 * stable code and a fixed message instead. Anything unrecognised is rethrown unchanged for
 * the (redacting) logger and reported to callers as a generic internal error.
 */
export function mapPgError(error: unknown): unknown {
  if (!isPgError(error)) return error;
  const code = typeof error.code === 'string' ? error.code : '';
  const constraint = typeof error.constraint === 'string' ? error.constraint : '';
  const hint = typeof error.hint === 'string' ? error.hint : '';

  if (hint === 'org.last_owner') {
    return preconditionFailed(
      'org.last_owner',
      'An organization must keep at least one active owner.',
    );
  }
  if (hint === 'identity.email_taken') {
    return conflict(
      'identity.email_taken',
      'That email address already belongs to another account.',
    );
  }
  switch (code) {
    case '23505':
      if (constraint === 'organizations_slug_key') {
        return conflict('organization.slug_taken', 'That organization address is already taken.');
      }
      if (constraint === 'memberships_pkey') {
        return conflict('member.exists', 'That user is already a member of this organization.');
      }
      return conflict('resource.conflict', 'The resource already exists.');
    case '23503':
      // A foreign key into memberships means the target is not a member of THIS organization.
      return notFound('member.not_found', 'That user is not a member of this organization.');
    case '23514':
      return validationError('input.invalid', 'One or more values are not valid.');
    case '42501':
      return forbidden('authz.denied', 'You do not have permission to perform this action.');
    default:
      return error;
  }
}

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapPgError(error);
  }
}

const roles = (values: readonly string[]): OrgRole[] => values.filter(isOrgRole);

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  kind: OrganizationSummary['kind'];
  status: OrganizationSummary['status'];
}

const toOrganization = (row: OrganizationRow): OrganizationSummary => ({
  id: OrganizationId.parse(row.id),
  name: row.name,
  slug: row.slug,
  kind: row.kind,
  status: row.status,
});

interface ApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  secret_hash: Buffer;
  last_four: string;
  scopes: string[];
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

const toApiKey = (row: ApiKeyRow): ApiKeyRecord => ({
  id: ApiKeyId.parse(row.id),
  organizationId: OrganizationId.parse(row.organization_id),
  name: row.name,
  secretHash: row.secret_hash,
  lastFour: row.last_four,
  scopes: row.scopes,
  createdBy: UserId.parse(row.created_by),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
});

const API_KEY_COLUMNS = `id, organization_id, name, secret_hash, last_four, scopes, created_by,
                         created_at, expires_at, revoked_at, last_used_at`;

async function scalarId(
  tx: StoreTx,
  sql: string,
  values: readonly unknown[],
): Promise<string | null> {
  const result = await tx.query<{ id: string | null }>(sql, values);
  return result.rows[0]?.id ?? null;
}

export const pgIamStore: IamStore = {
  async provisionUser(tx, input) {
    return guard(async () => {
      const id = await scalarId(tx, 'SELECT iam.provision_user($1, $2, $3, $4) AS id', [
        input.provider,
        input.subject,
        input.email,
        input.displayName,
      ]);
      return UserId.parse(id);
    });
  },

  async resolveIdentity(tx, provider, subject) {
    return guard(async () => {
      const id = await scalarId(tx, 'SELECT iam.resolve_identity($1, $2) AS id', [
        provider,
        subject,
      ]);
      return id === null ? null : UserId.parse(id);
    });
  },

  async createOrganization(tx, input) {
    return guard(async () => {
      const id = await scalarId(tx, 'SELECT iam.create_organization($1, $2, $3) AS id', [
        input.name,
        input.slug,
        input.kind,
      ]);
      return OrganizationId.parse(id);
    });
  },

  async listMyOrganizations(tx) {
    return guard(async () => {
      const result = await tx.query<OrganizationRow>(
        `SELECT o.id, o.name, o.slug::text AS slug, o.kind, o.status
           FROM iam.memberships m
           JOIN iam.organizations o ON o.id = m.organization_id
          WHERE m.user_id = app.current_user_id() AND m.status = 'active'
          ORDER BY o.name`,
      );
      return result.rows.map(toOrganization);
    });
  },

  async loadOrganization(tx) {
    return guard(async () => {
      const result = await tx.query<OrganizationRow>(
        `SELECT id, name, slug::text AS slug, kind, status
           FROM iam.organizations WHERE id = app.current_org_id()`,
      );
      const row = result.rows[0];
      return row === undefined ? null : toOrganization(row);
    });
  },

  async loadMembership(tx, userId) {
    return guard(async () => {
      const result = await tx.query<{ status: MembershipStatus; roles: string[] }>(
        `SELECT m.status,
                coalesce(array_agg(r.role_key) FILTER (WHERE r.role_key IS NOT NULL), '{}') AS roles
           FROM iam.memberships m
           LEFT JOIN iam.role_assignments r
             ON r.organization_id = m.organization_id AND r.user_id = m.user_id
          WHERE m.organization_id = app.current_org_id() AND m.user_id = $1
          GROUP BY m.status`,
        [userId],
      );
      const row = result.rows[0];
      return row === undefined ? null : { status: row.status, roles: roles(row.roles) };
    });
  },

  async listMembers(tx) {
    return guard(async () => {
      const result = await tx.query<{ user_id: string; status: MembershipStatus; roles: string[] }>(
        `SELECT m.user_id, m.status,
                coalesce(array_agg(r.role_key) FILTER (WHERE r.role_key IS NOT NULL), '{}') AS roles
           FROM iam.memberships m
           LEFT JOIN iam.role_assignments r
             ON r.organization_id = m.organization_id AND r.user_id = m.user_id
          WHERE m.organization_id = app.current_org_id()
          GROUP BY m.user_id, m.status, m.created_at
          ORDER BY m.created_at, m.user_id`,
      );
      return result.rows.map((row): MemberSummary => ({
        userId: UserId.parse(row.user_id),
        status: row.status,
        roles: roles(row.roles),
      }));
    });
  },

  async addMember(tx, userId, status = 'active') {
    await guard(() =>
      tx.query(
        `INSERT INTO iam.memberships (organization_id, user_id, status)
         VALUES (app.current_org_id(), $1, $2)`,
        [userId, status],
      ),
    );
  },

  async setMemberStatus(tx, userId, status) {
    const result = await guard(() =>
      tx.query(
        `UPDATE iam.memberships SET status = $2, updated_at = now()
          WHERE organization_id = app.current_org_id() AND user_id = $1`,
        [userId, status],
      ),
    );
    if (result.rowCount === 0) {
      throw notFound('member.not_found', 'That user is not a member of this organization.');
    }
  },

  async assignRole(tx, userId, role, grantedBy) {
    await guard(() =>
      tx.query(
        `INSERT INTO iam.role_assignments (organization_id, user_id, role_key, granted_by)
         VALUES (app.current_org_id(), $1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, role, grantedBy],
      ),
    );
  },

  async revokeRole(tx, userId, role) {
    await guard(() =>
      tx.query(
        `DELETE FROM iam.role_assignments
          WHERE organization_id = app.current_org_id() AND user_id = $1 AND role_key = $2`,
        [userId, role],
      ),
    );
  },

  async insertApiKey(tx, key) {
    await guard(() =>
      tx.query(
        `INSERT INTO iam.api_keys
           (organization_id, id, name, secret_hash, last_four, scopes, created_by, expires_at)
         VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          key.id,
          key.name,
          key.secretHash,
          key.lastFour,
          [...key.scopes],
          key.createdBy,
          key.expiresAt,
        ],
      ),
    );
  },

  async findApiKey(tx, keyId) {
    return guard(async () => {
      const result = await tx.query<ApiKeyRow>(
        `SELECT ${API_KEY_COLUMNS} FROM iam.api_keys
          WHERE organization_id = app.current_org_id() AND id = $1`,
        [keyId],
      );
      const row = result.rows[0];
      return row === undefined ? null : toApiKey(row);
    });
  },

  async listApiKeys(tx) {
    return guard(async () => {
      const result = await tx.query<ApiKeyRow>(
        `SELECT ${API_KEY_COLUMNS} FROM iam.api_keys
          WHERE organization_id = app.current_org_id() ORDER BY created_at DESC`,
      );
      return result.rows.map((row) => {
        const { secretHash: _omitted, ...rest } = toApiKey(row);
        return rest;
      });
    });
  },

  async revokeApiKey(tx, keyId) {
    const result = await guard(() =>
      tx.query(
        `UPDATE iam.api_keys SET revoked_at = coalesce(revoked_at, now())
          WHERE organization_id = app.current_org_id() AND id = $1`,
        [keyId],
      ),
    );
    if (result.rowCount === 0) throw notFound('api_key.not_found', 'API key not found.');
  },

  async touchApiKey(tx, keyId) {
    await guard(() =>
      tx.query(
        `UPDATE iam.api_keys SET last_used_at = now()
          WHERE organization_id = app.current_org_id() AND id = $1
            AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')`,
        [keyId],
      ),
    );
  },
};
