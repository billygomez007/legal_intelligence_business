import type { Tx } from '@legalintel/db';
import { conflict, forbidden, notFound, validationError } from '@legalintel/kernel';
import { JurisdictionId } from '@legalintel/legal-corpus';

import { ClientId, type Client, type ClientStatus } from '../domain/client.js';
import { MatterId, type Matter, type MatterStatus } from '../domain/matter.js';
import type {
  CreateClientInput,
  CreateMatterInput,
  UpdateClientInput,
  UpdateMatterInput,
  WorkspaceStore,
} from '../ports/workspace-store.js';

interface PgErrorLike {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

interface ClientRow {
  readonly organization_id: string;
  readonly id: string;
  readonly name: string;
  readonly reference: string | null;
  readonly status: ClientStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface MatterRow {
  readonly organization_id: string;
  readonly id: string;
  readonly client_id: string;
  readonly jurisdiction_id: string;
  readonly name: string;
  readonly reference: string | null;
  readonly status: MatterStatus;
  readonly opened_at: Date | null;
  readonly closed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const mapClient = (row: ClientRow): Client => ({
  id: ClientId.parse(row.id),
  organizationId: row.organization_id,
  name: row.name,
  reference: row.reference,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMatter = (row: MatterRow): Matter => ({
  id: MatterId.parse(row.id),
  organizationId: row.organization_id,
  clientId: ClientId.parse(row.client_id),
  jurisdictionId: JurisdictionId.parse(row.jurisdiction_id),
  name: row.name,
  reference: row.reference,
  status: row.status,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function mapWorkspaceError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return error;
  }

  const { code, constraint } = error as PgErrorLike;
  const c = typeof constraint === 'string' ? constraint : '';

  switch (code) {
    case '23505':
      return conflict(
        'workspace.conflict',
        'A workspace record with those identifying values already exists.',
      );

    case '23503':
      if (c.includes('client')) {
        return notFound(
          'workspace.client_not_found',
          'The client does not exist in this organization.',
        );
      }

      if (c.includes('jurisdiction')) {
        return notFound(
          'workspace.jurisdiction_not_found',
          'The jurisdiction does not exist in the canonical legal corpus.',
        );
      }

      return notFound(
        'workspace.reference_not_found',
        'A referenced workspace record does not exist in this organization.',
      );

    case '23514':
      return validationError(
        'workspace.invalid_state',
        'The workspace record is not in a valid state.',
      );

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
    throw mapWorkspaceError(error);
  }
}

export class PgWorkspaceStore implements WorkspaceStore<Tx> {
  async createClient(tx: Tx, input: CreateClientInput): Promise<Client> {
    return guard(async () => {
      const result = await tx.query<ClientRow>(
        `INSERT INTO workspace.clients
           (organization_id, id, name, reference)
         VALUES
           (app.current_org_id(), gen_random_uuid(), $1, $2)
         RETURNING
           organization_id,
           id,
           name,
           reference,
           status,
           created_at,
           updated_at`,
        [input.name, input.reference ?? null],
      );

      const row = result.rows[0];

      if (row === undefined) {
        throw new Error('workspace.create_client_no_row');
      }

      return mapClient(row);
    });
  }

  async findClientById(tx: Tx, clientId: ClientId): Promise<Client | null> {
    return guard(async () => {
      const result = await tx.query<ClientRow>(
        `SELECT
           organization_id,
           id,
           name,
           reference,
           status,
           created_at,
           updated_at
         FROM workspace.clients
         WHERE organization_id = app.current_org_id()
           AND id = $1`,
        [clientId],
      );

      const row = result.rows[0];

      return row === undefined ? null : mapClient(row);
    });
  }

  async listClients(tx: Tx): Promise<readonly Client[]> {
    return guard(async () => {
      const result = await tx.query<ClientRow>(
        `SELECT
           organization_id,
           id,
           name,
           reference,
           status,
           created_at,
           updated_at
         FROM workspace.clients
         WHERE organization_id = app.current_org_id()
         ORDER BY created_at DESC, id DESC`,
      );

      return result.rows.map(mapClient);
    });
  }

  async updateClient(tx: Tx, clientId: ClientId, input: UpdateClientInput): Promise<Client | null> {
    return guard(async () => {
      const result = await tx.query<ClientRow>(
        `UPDATE workspace.clients
         SET
           name = CASE
             WHEN $2::boolean THEN $3::text
             ELSE name
           END,
           reference = CASE
             WHEN $4::boolean THEN $5::text
             ELSE reference
           END,
           status = CASE
             WHEN $6::boolean THEN $7::text
             ELSE status
           END,
           updated_at = clock_timestamp()
         WHERE organization_id = app.current_org_id()
           AND id = $1
         RETURNING
           organization_id,
           id,
           name,
           reference,
           status,
           created_at,
           updated_at`,
        [
          clientId,
          input.name !== undefined,
          input.name ?? null,
          input.reference !== undefined,
          input.reference ?? null,
          input.status !== undefined,
          input.status ?? null,
        ],
      );

      const row = result.rows[0];

      return row === undefined ? null : mapClient(row);
    });
  }

  async createMatter(tx: Tx, input: CreateMatterInput): Promise<Matter> {
    return guard(async () => {
      const result = await tx.query<MatterRow>(
        `INSERT INTO workspace.matters
           (
             organization_id,
             id,
             client_id,
             jurisdiction_id,
             name,
             reference,
             opened_at
           )
         VALUES
           (
             app.current_org_id(),
             gen_random_uuid(),
             $1,
             $2,
             $3,
             $4,
             COALESCE($5, clock_timestamp())
           )
         RETURNING
           organization_id,
           id,
           client_id,
           jurisdiction_id,
           name,
           reference,
           status,
           opened_at,
           closed_at,
           created_at,
           updated_at`,
        [
          input.clientId,
          input.jurisdictionId,
          input.name,
          input.reference ?? null,
          input.openedAt ?? null,
        ],
      );

      const row = result.rows[0];

      if (row === undefined) {
        throw new Error('workspace.create_matter_no_row');
      }

      return mapMatter(row);
    });
  }

  async findMatterById(tx: Tx, matterId: MatterId): Promise<Matter | null> {
    return guard(async () => {
      const result = await tx.query<MatterRow>(
        `SELECT
           organization_id,
           id,
           client_id,
           jurisdiction_id,
           name,
           reference,
           status,
           opened_at,
           closed_at,
           created_at,
           updated_at
         FROM workspace.matters
         WHERE organization_id = app.current_org_id()
           AND id = $1`,
        [matterId],
      );

      const row = result.rows[0];

      return row === undefined ? null : mapMatter(row);
    });
  }

  async listMatters(tx: Tx): Promise<readonly Matter[]> {
    return guard(async () => {
      const result = await tx.query<MatterRow>(
        `SELECT
           organization_id,
           id,
           client_id,
           jurisdiction_id,
           name,
           reference,
           status,
           opened_at,
           closed_at,
           created_at,
           updated_at
         FROM workspace.matters
         WHERE organization_id = app.current_org_id()
         ORDER BY created_at DESC, id DESC`,
      );

      return result.rows.map(mapMatter);
    });
  }

  async listMattersForClient(tx: Tx, clientId: ClientId): Promise<readonly Matter[]> {
    return guard(async () => {
      const result = await tx.query<MatterRow>(
        `SELECT
           organization_id,
           id,
           client_id,
           jurisdiction_id,
           name,
           reference,
           status,
           opened_at,
           closed_at,
           created_at,
           updated_at
         FROM workspace.matters
         WHERE organization_id = app.current_org_id()
           AND client_id = $1
         ORDER BY created_at DESC, id DESC`,
        [clientId],
      );

      return result.rows.map(mapMatter);
    });
  }

  async updateMatter(tx: Tx, matterId: MatterId, input: UpdateMatterInput): Promise<Matter | null> {
    return guard(async () => {
      const result = await tx.query<MatterRow>(
        `UPDATE workspace.matters
         SET
           name = CASE
             WHEN $2::boolean THEN $3::text
             ELSE name
           END,
           reference = CASE
             WHEN $4::boolean THEN $5::text
             ELSE reference
           END,
           status = CASE
             WHEN $6::boolean THEN $7::text
             ELSE status
           END,
           closed_at = CASE
             WHEN $6::boolean AND $7::text = 'closed'
               THEN COALESCE(closed_at, clock_timestamp())
             WHEN $6::boolean AND $7::text <> 'closed'
               THEN NULL
             ELSE closed_at
           END,
           updated_at = clock_timestamp()
         WHERE organization_id = app.current_org_id()
           AND id = $1
         RETURNING
           organization_id,
           id,
           client_id,
           jurisdiction_id,
           name,
           reference,
           status,
           opened_at,
           closed_at,
           created_at,
           updated_at`,
        [
          matterId,
          input.name !== undefined,
          input.name ?? null,
          input.reference !== undefined,
          input.reference ?? null,
          input.status !== undefined,
          input.status ?? null,
        ],
      );

      const row = result.rows[0];

      return row === undefined ? null : mapMatter(row);
    });
  }
}

export const pgWorkspaceStore = new PgWorkspaceStore();
