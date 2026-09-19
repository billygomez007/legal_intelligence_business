/**
 * Local end-to-end demonstration of Stage 5 ingestion, over SYNTHETIC documents.
 *
 * It runs the real pipeline, as the real `legalintel_ingest` and `legalintel_dataops` roles, on a
 * database prepared by `pnpm db:setup`, and stops where the pipeline stops: versions awaiting
 * human review. Nothing is approved or published.
 *
 * It creates synthetic authorities. A production deploy refuses a database that holds any, so
 * this script refuses to run against production and refuses non-loopback hosts. Use a throwaway
 * database. See docs/runbooks/ingestion.md.
 *
 * Required environment: INGEST_DATABASE_URL, DATAOPS_DATABASE_URL, DB_BOOTSTRAP_ADMIN_URL (the
 * superuser, used only to create demo staff users). APP_ENV must not be "production".
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createPool, withPublicTransaction, type DbPool } from '@legalintel/db';
import {
  composeCatalog,
  permissionsForStaff,
  platformPermissions,
  type AuthzContext,
} from '@legalintel/iam';
import { UserId } from '@legalintel/kernel';
import { corpusStore } from '@legalintel/legal-corpus';
import { createLogger } from '@legalintel/observability';

import {
  BasicTextExtractor,
  createIngestionPipeline,
  createIngestionReview,
  hash,
  ingestionPermissions,
  labelledParser,
  LocalArtifactStorage,
  LocalInboxAcquirer,
  type IngestionRequest,
} from '../src';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required.`);
  return value;
}

function loopbackUrl(name: string): string {
  const value = required(name);
  if (!LOOPBACK.has(new URL(value).hostname)) {
    throw new Error(`${name} must point at a loopback host: this script creates synthetic data.`);
  }
  return value;
}

if (process.env['APP_ENV'] === 'production') {
  throw new Error('Refusing to run: this script creates synthetic authorities.');
}

const ingestUrl = loopbackUrl('INGEST_DATABASE_URL');
const dataopsUrl = loopbackUrl('DATAOPS_DATABASE_URL');
const adminUrl = new URL(loopbackUrl('DB_BOOTSTRAP_ADMIN_URL'));
adminUrl.pathname = new URL(ingestUrl).pathname; // the superuser, on the demo database

const say = (message: string) => {
  console.log(message);
};
const pool = (connectionString: string, applicationName: string): DbPool =>
  createPool({ connectionString, applicationName, max: 4 });

const admin = pool(adminUrl.toString(), 'ingestion-demo-admin');
const ingest = pool(ingestUrl, 'ingestion-demo-ingest');
const dataops = pool(dataopsUrl, 'ingestion-demo-dataops');
const root = mkdtempSync(join(realpathSync(tmpdir()), 'ingestion-demo-'));

try {
  const inbox = join(root, 'inbox');
  const objects = join(root, 'objects');
  for (const dir of [inbox, objects]) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o700);
  }

  // Staff. The database cannot know who the human is, so the application supplies it.
  const suffix = randomUUID().slice(0, 8);
  const userId = async (label: string): Promise<string> =>
    (
      await admin.query<{ id: string }>(
        'INSERT INTO iam.users (email, display_name) VALUES ($1, $2) RETURNING id',
        [`${label}-${suffix}@demo.example.test`, `SYNTHETIC ${label}`],
      )
    ).rows[0]?.id ?? '';
  const operatorId = await userId('operator');
  const rightsOfficerId = await userId('rights-officer');

  const catalog = composeCatalog([platformPermissions, ingestionPermissions]);
  const operator: AuthzContext = {
    principal: { kind: 'user', userId: UserId.parse(operatorId) },
    organizationId: null,
    permissions: permissionsForStaff(catalog, ['ingestion_operator']),
    roles: [],
  };

  // Reference data, as data-ops: a SYNTHETIC jurisdiction and source, with processing rights only.
  const { jurisdictionId, sourceId } = await withPublicTransaction(dataops, async (tx) => {
    const jurisdictionId = await corpusStore.createJurisdiction(tx, {
      code: `ZZ-${suffix.toUpperCase()}`.slice(0, 12),
      name: `SYNTHETIC Demo Jurisdiction ${suffix} (NOT REAL LAW)`,
      kind: 'country',
      isSynthetic: true,
    });
    const sourceId = await corpusStore.registerSource(tx, {
      jurisdictionId,
      name: `SYNTHETIC Demo Source ${suffix}`,
      kind: 'publisher',
    });
    await corpusStore.recordRightsDecision(tx, {
      sourceId,
      status: 'approved',
      allowedUses: ['acquire_store', 'derive_metadata'],
      evidenceReference: 'SYNTHETIC-DEMO-EVIDENCE',
      decidedBy: rightsOfficerId,
    });
    return { jurisdictionId, sourceId };
  });
  say(`Created a synthetic source with rights to acquire and structure only (not to display).`);

  const documents: { label: string; content: string; mediaType?: 'application/pdf' }[] = [
    {
      label: 'Act',
      content: [
        'Title: SYNTHETIC Widget Registration Act (NOT REAL LAW)',
        'Identifier: SYN/ACT/1',
        '',
        'PART 1',
        '1. A fictional widget must be registered with the fictional registrar.',
        '2. A fictional registration lasts for one fictional year.',
      ].join('\n'),
    },
    {
      label: 'Case citing the Act',
      content: [
        'Title: SYNTHETIC Alpha v Beta (NOT REAL LAW)',
        'Identifier: SYN/CASE/1',
        '',
        '1. The fictional court considered the registration rule. Cites: SYN/ACT/1',
        '2. The fictional appeal was allowed.',
      ].join('\n'),
    },
    {
      label: 'Act again (duplicate bytes)',
      content: [
        'Title: SYNTHETIC Widget Registration Act (NOT REAL LAW)',
        'Identifier: SYN/ACT/1',
        '',
        'PART 1',
        '1. A fictional widget must be registered with the fictional registrar.',
        '2. A fictional registration lasts for one fictional year.',
      ].join('\n'),
    },
    {
      label: 'A PDF',
      content: '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
      mediaType: 'application/pdf',
    },
  ];

  const logger = createLogger({ service: 'ingestion-demo', level: 'warn' });
  const pipeline = createIngestionPipeline({
    pool: ingest,
    environment: 'development',
    storage: new LocalArtifactStorage(objects),
    acquirer: new LocalInboxAcquirer(inbox),
    extractor: new BasicTextExtractor(),
    parsers: [labelledParser],
    logger,
  });

  const results: Record<string, string>[] = [];
  for (const document of documents) {
    const bytes = Buffer.from(document.content, 'utf8');
    const inputReference = randomUUID();
    writeFileSync(join(inbox, `${sourceId}-${inputReference}`), bytes, { mode: 0o600 });
    const request: IngestionRequest = {
      sourceId,
      jurisdictionId,
      operation: 'structure',
      inputReference,
      expectedChecksum: hash(bytes),
      mediaType: document.mediaType ?? 'text/plain',
      parserId: 'labelled-v1',
      documentType: document.label.startsWith('Case') ? 'case' : 'legislation',
      idempotencyKey: `demo-${randomUUID()}`,
      actorId: operatorId,
      correlationId: randomUUID(),
    };
    const job = await pipeline.run((await pipeline.request(operator, request)).id);
    results.push({
      document: document.label,
      status: job.status,
      outcome: job.failureCategory ?? 'awaiting human review',
    });
  }
  console.table(results);

  const summary = (
    await dataops.query<{ state: string; n: string }>(
      `SELECT lifecycle_state AS state, count(*) AS n FROM corpus.document_versions
        WHERE source_id = $1 GROUP BY 1 ORDER BY 1`,
      [sourceId],
    )
  ).rows;
  const tasks = await dataops.query<{ reason: string; n: string }>(
    `SELECT t.reason, count(*) AS n FROM ingestion.review_tasks t JOIN ingestion.jobs j ON j.id = t.job_id
      WHERE j.source_id = $1 GROUP BY 1 ORDER BY 1`,
    [sourceId],
  );
  const edges = await dataops.query<{ n: string }>(
    `SELECT count(*) AS n FROM graph.citations c JOIN corpus.document_versions v ON v.id = c.from_version_id
      WHERE v.source_id = $1`,
    [sourceId],
  );
  say(`Corpus versions by state: ${summary.map((row) => `${row.state}=${row.n}`).join(', ')}`);
  say(`Review tasks by reason:   ${tasks.rows.map((row) => `${row.reason}=${row.n}`).join(', ')}`);
  say(`Machine citation edges:   ${edges.rows[0]?.n ?? '0'} (unreviewed)`);

  // The review queue, as a reviewer would see it.
  const review = createIngestionReview({ pool: dataops, environment: 'development' });
  const reviewerId = await userId('reviewer');
  const reviewer: AuthzContext = {
    principal: { kind: 'user', userId: UserId.parse(reviewerId) },
    organizationId: null,
    permissions: permissionsForStaff(catalog, ['data_reviewer']),
    roles: [],
  };
  const queue = await review.queue(reviewer, 20);
  say(
    `${queue.length} review tasks are waiting for a person. Nothing has been approved or published.`,
  );
  say('');
  say('This database now holds SYNTHETIC authorities. A production deploy will refuse it.');
} finally {
  await Promise.all([admin.end(), ingest.end(), dataops.end()]);
  rmSync(root, { recursive: true, force: true });
}
