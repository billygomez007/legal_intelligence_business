import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditMigrations } from '@legalintel/audit';
import { platformMigrations, withPublicTransaction, type DbPool } from '@legalintel/db';
import { createTestDatabase, type TestDatabase } from '@legalintel/db/testing';
import {
  composeCatalog,
  iamMigrations,
  permissionsForStaff,
  platformPermissions,
  type AuthzContext,
} from '@legalintel/iam';
import { UserId } from '@legalintel/kernel';
import {
  corpusMigrations,
  corpusStore,
  type JurisdictionId,
  type RightsStatus,
  type RightsUse,
  type SourceId,
} from '@legalintel/legal-corpus';
import { createLogger } from '@legalintel/observability';

import {
  BasicTextExtractor,
  createIngestionPipeline,
  createIngestionReview,
  hash,
  ingestionMigrations,
  ingestionPermissions,
  labelledParser,
  LocalArtifactStorage,
  LocalInboxAcquirer,
  PgIngestionStore,
  type IngestionRequest,
  type PipelineDependencies,
} from '../src';

export type Tx = Parameters<Parameters<typeof withPublicTransaction>[1]>[0];

export interface World {
  readonly jurisdictionId: JurisdictionId;
  readonly sourceId: SourceId;
}

export interface PrepareOptions {
  mediaType?: IngestionRequest['mediaType'];
  documentType?: IngestionRequest['documentType'];
  key?: string;
  /** Write the object into the inbox (default). False simulates a source that is not ready. */
  provision?: boolean;
  sourceId?: SourceId;
}

let counter = 0;
export const unique = (label: string) => `${label}-${Date.now().toString(36)}-${(counter += 1)}`;

/** A small synthetic document. Titles are unique so tests do not trip duplicate detection. */
export function syntheticDocument(
  title: string,
  options: { identifier?: string; extra?: string[] } = {},
): string {
  return [
    `Title: SYNTHETIC ${title} (NOT REAL LAW)`,
    ...(options.identifier === undefined ? [] : [`Identifier: ${options.identifier}`]),
    '',
    `1. A fictional provision of ${title} applies to fictional widgets.`,
    ...(options.extra ?? []),
  ].join('\n');
}

/**
 * Real PostgreSQL with every migration set, real files in a private directory, and the real
 * pipeline. Nothing here is mocked: the properties under test belong to the database and to
 * the adapters, and a mock would only test our assumptions about them.
 */
export async function createHarness() {
  const database: TestDatabase = await createTestDatabase({
    migrationSets: [
      platformMigrations,
      iamMigrations,
      auditMigrations,
      corpusMigrations,
      ingestionMigrations,
    ],
  });
  const ingest: DbPool = database.poolFor('ingest');
  const dataops: DbPool = database.poolFor('dataops');
  const app: DbPool = database.poolFor('app');

  const staff = { rights: '', operator: '', reviewer: '', publisher: '', other: '' };
  for (const key of Object.keys(staff) as (keyof typeof staff)[]) {
    const result = await database.withAdmin((c) =>
      c.query<{ id: string }>(
        'INSERT INTO iam.users (email, display_name) VALUES ($1, $2) RETURNING id',
        [`${key}@staff.example.test`, key],
      ),
    );
    staff[key] = result.rows[0]?.id ?? '';
  }

  const root = mkdtempSync(join(realpathSync(tmpdir()), 'ingestion-it-'));
  const inbox = join(root, 'inbox');
  const objects = join(root, 'objects');
  for (const dir of [inbox, objects]) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o700);
  }

  const logs: string[] = [];
  const logger = createLogger({
    service: 'ingestion-test',
    level: 'debug',
    destination: {
      write: (line: string) => {
        logs.push(line);
      },
    },
  });

  const catalog = composeCatalog([platformPermissions, ingestionPermissions]);
  const contextFor = (userId: string, role: string): AuthzContext => ({
    principal: { kind: 'user', userId: UserId.parse(userId) },
    organizationId: null,
    permissions: permissionsForStaff(catalog, [role]),
    roles: [],
  });

  const asIngest = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(ingest, fn);
  const asDataops = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(dataops, fn);
  const asApp = <T>(fn: (tx: Tx) => Promise<T>) => withPublicTransaction(app, fn);

  /** Reads as a superuser, for assertions. Bypasses row-level security by design. */
  const q = async <T extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> =>
    database.withAdmin(async (c) => (await c.query<T>(sql, params as unknown[])).rows);

  const storage = () => new LocalArtifactStorage(objects);

  const dependencies = (
    extra: Partial<PipelineDependencies> = {},
  ): Omit<PipelineDependencies, 'store' | 'assertSafe' | 'checksum'> => ({
    storage: storage(),
    acquirer: new LocalInboxAcquirer(inbox),
    extractor: new BasicTextExtractor(),
    parsers: [labelledParser],
    logger,
    ...extra,
  });

  const pipeline = (extra: Partial<PipelineDependencies> = {}) =>
    createIngestionPipeline({
      pool: ingest,
      environment: 'test',
      ...dependencies(extra),
    });
  const review = () => createIngestionReview({ pool: dataops, environment: 'test' });
  const store = () => new PgIngestionStore(ingest);

  const operator = () => contextFor(staff.operator, 'ingestion_operator');
  const reviewer = () => contextFor(staff.reviewer, 'data_reviewer');
  const publisher = () => contextFor(staff.publisher, 'data_publisher');

  const grant = (
    sourceId: SourceId,
    status: RightsStatus,
    uses: readonly RightsUse[],
    extra: { expiresAt?: Date; effectiveFrom?: Date } = {},
  ) =>
    asDataops((tx) =>
      corpusStore.recordRightsDecision(tx, {
        sourceId,
        status,
        allowedUses: uses,
        ...(status === 'approved' ? { evidenceReference: 'SYNTHETIC-EVIDENCE' } : {}),
        decidedBy: staff.rights,
        ...extra,
      }),
    );
  const revoke = (sourceId: SourceId) => grant(sourceId, 'revoked', []);

  /** A fresh synthetic jurisdiction and source, so rights can differ per test. */
  async function world(
    uses: readonly RightsUse[] | null = ['acquire_store', 'derive_metadata'],
  ): Promise<World> {
    const created = await asDataops(async (tx) => {
      const suffix = (counter += 1).toString(36).toUpperCase();
      const jurisdictionId = await corpusStore.createJurisdiction(tx, {
        code: `ZZ-${suffix}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
        name: unique('SYNTHETIC jurisdiction'),
        kind: 'country',
        isSynthetic: true,
      });
      const sourceId = await corpusStore.registerSource(tx, {
        jurisdictionId,
        name: unique('SYNTHETIC source'),
        kind: 'publisher',
      });
      return { jurisdictionId, sourceId };
    });
    if (uses !== null) await grant(created.sourceId, 'approved', uses);
    return created;
  }

  /** A second source in the same jurisdiction, with the same processing rights. */
  async function secondSource(w: World): Promise<SourceId> {
    const sourceId = await asDataops((tx) =>
      corpusStore.registerSource(tx, {
        jurisdictionId: w.jurisdictionId,
        name: unique('SYNTHETIC second source'),
        kind: 'publisher',
      }),
    );
    await grant(sourceId, 'approved', ['acquire_store', 'derive_metadata']);
    return sourceId;
  }

  /** Puts the bytes in the inbox and returns the request that names them. */
  function prepare(
    w: World,
    content: string | Uint8Array,
    options: PrepareOptions = {},
  ): IngestionRequest {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const inputReference = randomUUID();
    const sourceId = options.sourceId ?? w.sourceId;
    if (options.provision !== false) {
      writeFileSync(join(inbox, `${sourceId}-${inputReference}`), bytes, { mode: 0o600 });
    }
    return {
      sourceId,
      jurisdictionId: w.jurisdictionId,
      operation: 'structure',
      inputReference,
      expectedChecksum: hash(bytes),
      mediaType: options.mediaType ?? 'text/plain',
      parserId: 'labelled-v1',
      documentType: options.documentType ?? 'legislation',
      idempotencyKey: options.key ?? `key-${randomUUID()}`,
      actorId: staff.operator,
      correlationId: randomUUID(),
    };
  }

  /** Request and run one document through the real pipeline. */
  async function ingestDocument(
    w: World,
    content: string | Uint8Array,
    options: PrepareOptions = {},
  ) {
    const p = pipeline();
    const requested = await p.request(operator(), prepare(w, content, options));
    return p.run(requested.id);
  }

  /**
   * What a careful reviewer does before approving: verifies, against the source, every
   * publish-critical field the corpus holds a value for (approval refuses to proceed otherwise).
   */
  const verifyCritical = async (taskId: string): Promise<void> => {
    const packet = await review().packet(reviewer(), taskId);
    const rows = packet['criticalMetadata'] as {
      field: string;
      value: string | null;
      valueSha256: string | null;
      blocking: boolean;
    }[];
    const verifications = rows
      .filter((row) => row.blocking && row.value !== null && row.valueSha256 !== null)
      .map((row) => ({
        field: row.field,
        status: 'verified',
        valueSha256: row.valueSha256,
        evidenceReference: 'SYNTHETIC: read against the source text',
      }));
    if (verifications.length > 0)
      await review().verifyMetadata(reviewer(), { taskId, verifications });
  };

  const taskFor = async (jobId: string): Promise<string> => {
    const rows = await q<{ id: string }>(
      'SELECT id FROM ingestion.review_tasks WHERE job_id = $1',
      [jobId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('no review task for the job');
    return id;
  };

  /**
   * Test-only: moves a failed job's retry time into the past. The jobs guard forbids any edit
   * to a settled job, so the trigger is disabled for this one statement, by the superuser, in
   * a scratch database.
   */
  const expireBackoff = (jobId: string) =>
    database.withAdmin(async (c) => {
      await c.query('ALTER TABLE ingestion.jobs DISABLE TRIGGER jobs_guard');
      try {
        await c.query(
          "UPDATE ingestion.jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1",
          [jobId],
        );
      } finally {
        await c.query('ALTER TABLE ingestion.jobs ENABLE TRIGGER jobs_guard');
      }
    });

  return {
    database,
    ingest,
    dataops,
    app,
    staff,
    inbox,
    objects,
    logs,
    logger,
    catalog,
    contextFor,
    asIngest,
    asDataops,
    asApp,
    q,
    storage,
    dependencies,
    pipeline,
    review,
    store,
    operator,
    reviewer,
    publisher,
    grant,
    revoke,
    world,
    secondSource,
    prepare,
    ingestDocument,
    verifyCritical,
    taskFor,
    expireBackoff,
    async dispose() {
      await database.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
