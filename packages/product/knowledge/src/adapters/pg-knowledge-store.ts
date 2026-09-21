import type { Tx } from '@legalintel/db';
import { conflict, forbidden, notFound, validationError } from '@legalintel/kernel';

import {
  KnowledgeSourceId,
  type KnowledgeSource,
  type KnowledgeSourceStatus,
} from '../domain/source.js';
import { KnowledgeSourceVersionId, type KnowledgeSourceVersion } from '../domain/source-version.js';
import type {
  CreateKnowledgeSourceInput,
  CreateKnowledgeSourceVersionInput,
  KnowledgeStore,
  UpdateKnowledgeSourceInput,
} from '../ports/knowledge-store.js';

interface PgErrorLike {
  readonly code?: string;
  readonly constraint?: string;
}

interface SourceRow {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: KnowledgeSourceStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface VersionRow {
  readonly id: string;
  readonly organization_id: string;
  readonly source_id: string;
  readonly version_number: number;
  readonly original_filename: string;
  readonly mime_type: string;
  readonly storage_key: string;
  readonly content_sha256: string;
  readonly size_bytes: string | number;
  readonly created_at: Date;
}

function source(row: SourceRow): KnowledgeSource {
  return {
    id: KnowledgeSourceId.parse(row.id),
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function version(row: VersionRow): KnowledgeSourceVersion {
  return {
    id: KnowledgeSourceVersionId.parse(row.id),
    organizationId: row.organization_id,
    sourceId: KnowledgeSourceId.parse(row.source_id),
    versionNumber: row.version_number,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    contentSha256: row.content_sha256,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  };
}

function pgError(error: unknown): PgErrorLike | null {
  if (typeof error !== 'object' || error === null) return null;
  return error;
}

export function mapKnowledgeStoreError(error: unknown): unknown {
  const pg = pgError(error);
  if (pg === null) return error;

  switch (pg.code) {
    case '23505':
      return conflict('knowledge.conflict', 'The Firm Knowledge resource already exists.');

    case '23503':
      if (pg.constraint?.includes('source')) {
        return notFound('knowledge.source_not_found', 'The Firm Knowledge source was not found.');
      }

      return notFound(
        'knowledge.reference_not_found',
        'A referenced Firm Knowledge resource was not found.',
      );

    case '23514':
      return validationError('knowledge.invalid_state', 'The Firm Knowledge resource is invalid.');

    case '42501':
      return forbidden('authz.denied', 'You do not have permission to perform this action.');

    case undefined:
      return error;
    default:
      return error;
  }
}

async function mapped<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapKnowledgeStoreError(error);
  }
}

export class PgKnowledgeStore implements KnowledgeStore<Tx> {
  async createSource(tx: Tx, input: CreateKnowledgeSourceInput): Promise<KnowledgeSource> {
    return mapped(async () => {
      const result = await tx.query<SourceRow>(
        `INSERT INTO knowledge.sources (
           organization_id,
           id,
           name,
           description
         )
         VALUES (
           app.current_org_id(),
           $1,
           $2,
           $3
         )
         RETURNING
           id,
           organization_id,
           name,
           description,
           status,
           created_at,
           updated_at`,
        [input.id, input.name, input.description ?? null],
      );

      const created = result.rows[0];
      if (created === undefined) {
        throw new Error('knowledge.persistence_missing_source_row');
      }
      return source(created);
    });
  }

  async findSource(tx: Tx, id: KnowledgeSourceId): Promise<KnowledgeSource | null> {
    return mapped(async () => {
      const result = await tx.query<SourceRow>(
        `SELECT
           id,
           organization_id,
           name,
           description,
           status,
           created_at,
           updated_at
         FROM knowledge.sources
         WHERE organization_id = app.current_org_id()
           AND id = $1`,
        [id],
      );

      return result.rows[0] ? source(result.rows[0]) : null;
    });
  }

  async listSources(tx: Tx, status?: KnowledgeSourceStatus): Promise<readonly KnowledgeSource[]> {
    return mapped(async () => {
      const result = await tx.query<SourceRow>(
        `SELECT
           id,
           organization_id,
           name,
           description,
           status,
           created_at,
           updated_at
         FROM knowledge.sources
         WHERE organization_id = app.current_org_id()
           AND ($1::text IS NULL OR status = $1)
         ORDER BY updated_at DESC, id`,
        [status ?? null],
      );

      return result.rows.map(source);
    });
  }

  async updateSource(tx: Tx, input: UpdateKnowledgeSourceInput): Promise<KnowledgeSource | null> {
    return mapped(async () => {
      const result = await tx.query<SourceRow>(
        `UPDATE knowledge.sources
         SET
           name = $2,
           description = $3,
           updated_at = now()
         WHERE organization_id = app.current_org_id()
           AND id = $1
         RETURNING
           id,
           organization_id,
           name,
           description,
           status,
           created_at,
           updated_at`,
        [input.id, input.name, input.description ?? null],
      );

      return result.rows[0] ? source(result.rows[0]) : null;
    });
  }

  async setSourceStatus(
    tx: Tx,
    id: KnowledgeSourceId,
    status: KnowledgeSourceStatus,
  ): Promise<KnowledgeSource | null> {
    return mapped(async () => {
      const result = await tx.query<SourceRow>(
        `UPDATE knowledge.sources
         SET
           status = $2,
           updated_at = now()
         WHERE organization_id = app.current_org_id()
           AND id = $1
         RETURNING
           id,
           organization_id,
           name,
           description,
           status,
           created_at,
           updated_at`,
        [id, status],
      );

      return result.rows[0] ? source(result.rows[0]) : null;
    });
  }

  async createSourceVersion(
    tx: Tx,
    input: CreateKnowledgeSourceVersionInput,
  ): Promise<KnowledgeSourceVersion> {
    return mapped(async () => {
      const lockedSource = await tx.query<{ id: string }>(
        `SELECT id
         FROM knowledge.sources
         WHERE organization_id = app.current_org_id()
           AND id = $1
         FOR UPDATE`,
        [input.sourceId],
      );

      if (lockedSource.rows[0] === undefined) {
        throw new Error('knowledge.persistence_missing_source');
      }

      const result = await tx.query<VersionRow>(
        `INSERT INTO knowledge.source_versions (
           organization_id,
           id,
           source_id,
           version_number,
           original_filename,
           mime_type,
           storage_key,
           content_sha256,
           size_bytes
         )
         SELECT
           app.current_org_id(),
           $1,
           $2,
           COALESCE(MAX(version_number), 0) + 1,
           $3,
           $4,
           $5,
           $6,
           $7
         FROM knowledge.source_versions
         WHERE organization_id = app.current_org_id()
           AND source_id = $2
         RETURNING
           id,
           organization_id,
           source_id,
           version_number,
           original_filename,
           mime_type,
           storage_key,
           content_sha256,
           size_bytes,
           created_at`,
        [
          input.id,
          input.sourceId,
          input.originalFilename,
          input.mimeType,
          input.storageKey,
          input.contentSha256,
          input.sizeBytes,
        ],
      );

      const created = result.rows[0];
      if (created === undefined) {
        throw new Error('knowledge.persistence_missing_source_version_row');
      }
      return version(created);
    });
  }

  async listSourceVersions(
    tx: Tx,
    sourceId: KnowledgeSourceId,
  ): Promise<readonly KnowledgeSourceVersion[]> {
    return mapped(async () => {
      const result = await tx.query<VersionRow>(
        `SELECT
           id,
           organization_id,
           source_id,
           version_number,
           original_filename,
           mime_type,
           storage_key,
           content_sha256,
           size_bytes,
           created_at
         FROM knowledge.source_versions
         WHERE organization_id = app.current_org_id()
           AND source_id = $1
         ORDER BY version_number DESC`,
        [sourceId],
      );

      return result.rows.map(version);
    });
  }
}
