import type { JurisdictionId } from '@legalintel/legal-corpus';

import type { Client, ClientId, ClientStatus } from '../domain/client.js';
import type { Matter, MatterId, MatterStatus } from '../domain/matter.js';

export interface CreateClientInput {
  readonly name: string;
  readonly reference?: string;
}

export interface UpdateClientInput {
  readonly name?: string;
  readonly reference?: string | null;
  readonly status?: ClientStatus;
}

export interface CreateMatterInput {
  readonly clientId: ClientId;
  readonly jurisdictionId: JurisdictionId;
  readonly name: string;
  readonly reference?: string;
  readonly openedAt?: Date;
}

export interface UpdateMatterInput {
  readonly name?: string;
  readonly reference?: string | null;
  readonly status?: MatterStatus;
}

export interface WorkspaceStore<TTransaction> {
  createClient(tx: TTransaction, input: CreateClientInput): Promise<Client>;

  findClientById(tx: TTransaction, clientId: ClientId): Promise<Client | null>;

  listClients(tx: TTransaction): Promise<readonly Client[]>;

  updateClient(
    tx: TTransaction,
    clientId: ClientId,
    input: UpdateClientInput,
  ): Promise<Client | null>;

  createMatter(tx: TTransaction, input: CreateMatterInput): Promise<Matter>;

  findMatterById(tx: TTransaction, matterId: MatterId): Promise<Matter | null>;

  listMatters(tx: TTransaction): Promise<readonly Matter[]>;

  listMattersForClient(tx: TTransaction, clientId: ClientId): Promise<readonly Matter[]>;

  updateMatter(
    tx: TTransaction,
    matterId: MatterId,
    input: UpdateMatterInput,
  ): Promise<Matter | null>;
}
