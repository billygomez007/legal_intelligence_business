import { safeWorkProductQuery } from './work-product-database-error.js';
import type { Tx } from '@legalintel/db';

import type {
  AppendWorkProductRevisionStoreInput,
  CreateWorkProductStoreInput,
  RecordWorkProductReviewStoreInput,
  StoredWorkProduct,
  StoredWorkProductReview,
  StoredWorkProductRevision,
  WorkProductStore,
} from '../ports/work-product-store.js';

interface WorkProductRow {
  organization_id: string;
  id: string;
  ai_task_id: string;
  matter_id: string | null;
  title: string;
  kind: string;
  status: StoredWorkProduct['status'];
  current_revision_id: string | null;
  submitted_revision_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

interface RevisionRow {
  organization_id: string;
  id: string;
  work_product_id: string;
  revision_number: number;
  task_scope_revision: number;
  previous_revision_id: string | null;
  content: string;
  content_format: 'plain_text' | 'markdown';
  content_sha256: string;
  revision_sha256: string;
  created_by: string;
  created_at: Date;
}

interface ReviewRow {
  organization_id: string;
  id: string;
  work_product_id: string;
  revision_id: string;
  decision: 'approved' | 'rejected';
  reason: string | null;
  decided_by: string;
  decided_at: Date;
}

const workProductColumns = `
  organization_id,
  id,
  ai_task_id,
  matter_id,
  title,
  kind,
  status,
  current_revision_id,
  submitted_revision_id,
  created_by,
  created_at,
  updated_at,
  archived_at
`;

const revisionColumns = `
  organization_id,
  id,
  work_product_id,
  revision_number,
  task_scope_revision,
  previous_revision_id,
  content,
  content_format,
  content_sha256,
  revision_sha256,
  created_by,
  created_at
`;

function mapWorkProduct(row: WorkProductRow): StoredWorkProduct {
  return {
    organizationId: row.organization_id,
    id: row.id,
    aiTaskId: row.ai_task_id,
    matterId: row.matter_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    submittedRevisionId: row.submitted_revision_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapRevision(row: RevisionRow): StoredWorkProductRevision {
  return {
    organizationId: row.organization_id,
    id: row.id,
    workProductId: row.work_product_id,
    revisionNumber: row.revision_number,
    taskScopeRevision: row.task_scope_revision,
    previousRevisionId: row.previous_revision_id,
    content: row.content,
    contentFormat: row.content_format,
    contentSha256: row.content_sha256,
    revisionSha256: row.revision_sha256,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapReview(row: ReviewRow): StoredWorkProductReview {
  return {
    organizationId: row.organization_id,
    id: row.id,
    workProductId: row.work_product_id,
    revisionId: row.revision_id,
    decision: row.decision,
    reason: row.reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

export class PgWorkProductStore implements WorkProductStore<Tx> {
  async createWorkProduct(tx: Tx, input: CreateWorkProductStoreInput): Promise<StoredWorkProduct> {
    const result = await safeWorkProductQuery(() =>
      tx.query<WorkProductRow>(
        `INSERT INTO work_products.work_products
         (
           organization_id,
           id,
           ai_task_id,
           matter_id,
           title,
           kind,
           created_by
         )
       VALUES (
         app.current_org_id(),
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         $6::uuid
       )
       RETURNING ${workProductColumns}`,
        [input.id, input.aiTaskId, input.matterId, input.title, input.kind, input.createdBy],
      ),
    );

    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('work_product.create_failed');
    }

    return mapWorkProduct(row);
  }

  async findWorkProduct(tx: Tx, id: string): Promise<StoredWorkProduct | null> {
    const result = await safeWorkProductQuery(() =>
      tx.query<WorkProductRow>(
        `SELECT ${workProductColumns}
         FROM work_products.work_products
        WHERE organization_id = app.current_org_id()
          AND id = $1::uuid`,
        [id],
      ),
    );

    const row = result.rows[0];

    return row === undefined ? null : mapWorkProduct(row);
  }

  async listRevisions(
    tx: Tx,
    workProductId: string,
  ): Promise<readonly StoredWorkProductRevision[]> {
    const result = await safeWorkProductQuery(() =>
      tx.query<RevisionRow>(
        `SELECT ${revisionColumns}
         FROM work_products.revisions
        WHERE organization_id = app.current_org_id()
          AND work_product_id = $1::uuid
        ORDER BY revision_number`,
        [workProductId],
      ),
    );

    return result.rows.map(mapRevision);
  }

  async appendRevision(
    tx: Tx,
    input: AppendWorkProductRevisionStoreInput,
  ): Promise<StoredWorkProductRevision> {
    const aggregateResult = await safeWorkProductQuery(() =>
      tx.query<{
        id: string;
        current_revision_id: string | null;
        status: string;
      }>(
        `SELECT
         id,
         current_revision_id,
         status
       FROM work_products.work_products
       WHERE organization_id = app.current_org_id()
         AND id = $1::uuid
       FOR UPDATE`,
        [input.workProductId],
      ),
    );

    const aggregate = aggregateResult.rows[0];

    if (aggregate === undefined || aggregate.status === 'archived') {
      throw new Error('work_product.not_available');
    }

    const numberResult = await safeWorkProductQuery(() =>
      tx.query<{
        next_revision: number;
      }>(
        `SELECT
         coalesce(max(revision_number), 0) + 1
           AS next_revision
       FROM work_products.revisions
       WHERE organization_id = app.current_org_id()
         AND work_product_id = $1::uuid`,
        [input.workProductId],
      ),
    );

    const revisionNumber = numberResult.rows[0]?.next_revision;

    if (
      revisionNumber === undefined ||
      !Number.isSafeInteger(revisionNumber) ||
      revisionNumber < 1
    ) {
      throw new Error('work_product.revision_allocation_failed');
    }

    const inserted = await safeWorkProductQuery(() =>
      tx.query<RevisionRow>(
        `INSERT INTO work_products.revisions
         (
           organization_id,
           id,
           work_product_id,
           revision_number,
           task_scope_revision,
           previous_revision_id,
           content,
           content_format,
           content_sha256,
           revision_sha256,
           created_by
         )
       VALUES (
         app.current_org_id(),
         $1::uuid,
         $2::uuid,
         $3,
         $4,
         $5::uuid,
         $6,
         $7,
         $8,
         $9,
         $10::uuid
       )
       RETURNING ${revisionColumns}`,
        [
          input.id,
          input.workProductId,
          revisionNumber,
          input.taskScopeRevision,
          aggregate.current_revision_id,
          input.content,
          input.contentFormat,
          input.contentSha256,
          input.revisionSha256,
          input.createdBy,
        ],
      ),
    );

    const revision = inserted.rows[0];

    if (revision === undefined) {
      throw new Error('work_product.revision_create_failed');
    }

    for (let ordinal = 0; ordinal < input.provenance.length; ordinal += 1) {
      const reference = input.provenance[ordinal];

      if (reference === undefined) {
        throw new Error('work_product.provenance_invalid');
      }

      await safeWorkProductQuery(() =>
        tx.query(
          `INSERT INTO work_products.revision_provenance
           (
             organization_id,
             revision_id,
             ordinal,
             source_kind,
             source_id,
             version_id,
             locator,
             recorded_by
           )
         VALUES (
           app.current_org_id(),
           $1::uuid,
           $2,
           $3,
           $4::uuid,
           $5::uuid,
           $6,
           $7::uuid
         )`,
          [
            revision.id,
            ordinal,
            reference.kind,
            reference.sourceId,
            reference.versionId,
            reference.locator,
            input.createdBy,
          ],
        ),
      );
    }

    await safeWorkProductQuery(() =>
      tx.query(
        `UPDATE work_products.work_products
          SET current_revision_id = $2::uuid,
              submitted_revision_id = NULL,
              status = 'draft',
              archived_at = NULL,
              updated_at = now()
        WHERE organization_id = app.current_org_id()
          AND id = $1::uuid`,
        [input.workProductId, revision.id],
      ),
    );

    return mapRevision(revision);
  }

  async submitRevision(
    tx: Tx,
    workProductId: string,
    revisionId: string,
  ): Promise<StoredWorkProduct | null> {
    const result = await safeWorkProductQuery(() =>
      tx.query<WorkProductRow>(
        `UPDATE work_products.work_products
          SET status = 'submitted',
              submitted_revision_id = $2::uuid,
              updated_at = now()
        WHERE organization_id = app.current_org_id()
          AND id = $1::uuid
          AND current_revision_id = $2::uuid
          AND status = 'draft'
       RETURNING ${workProductColumns}`,
        [workProductId, revisionId],
      ),
    );

    const row = result.rows[0];

    return row === undefined ? null : mapWorkProduct(row);
  }

  async recordReview(
    tx: Tx,
    input: RecordWorkProductReviewStoreInput,
  ): Promise<StoredWorkProductReview | null> {
    const locked = await safeWorkProductQuery(() =>
      tx.query<{
        status: string;
        current_revision_id: string | null;
        submitted_revision_id: string | null;
      }>(
        `SELECT
         status,
         current_revision_id,
         submitted_revision_id
       FROM work_products.work_products
       WHERE organization_id = app.current_org_id()
         AND id = $1::uuid
       FOR UPDATE`,
        [input.workProductId],
      ),
    );

    const aggregate = locked.rows[0];

    if (
      aggregate?.status !== 'submitted' ||
      aggregate.current_revision_id !== input.revisionId ||
      aggregate.submitted_revision_id !== input.revisionId
    ) {
      return null;
    }

    const inserted = await safeWorkProductQuery(() =>
      tx.query<ReviewRow>(
        `INSERT INTO work_products.reviews
         (
           organization_id,
           id,
           work_product_id,
           revision_id,
           decision,
           reason,
           decided_by
         )
       VALUES (
         app.current_org_id(),
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         $6::uuid
       )
       RETURNING
         organization_id,
         id,
         work_product_id,
         revision_id,
         decision,
         reason,
         decided_by,
         decided_at`,
        [
          input.id,
          input.workProductId,
          input.revisionId,
          input.decision,
          input.reason,
          input.decidedBy,
        ],
      ),
    );

    const review = inserted.rows[0];

    if (review === undefined) {
      throw new Error('work_product.review_create_failed');
    }

    await safeWorkProductQuery(() =>
      tx.query(
        `UPDATE work_products.work_products
          SET status = $2,
              updated_at = now()
        WHERE organization_id = app.current_org_id()
          AND id = $1::uuid
          AND current_revision_id = $3::uuid
          AND submitted_revision_id = $3::uuid
          AND status = 'submitted'`,
        [input.workProductId, input.decision, input.revisionId],
      ),
    );

    return mapReview(review);
  }

  async archiveWorkProduct(tx: Tx, workProductId: string): Promise<StoredWorkProduct | null> {
    const result = await safeWorkProductQuery(() =>
      tx.query<WorkProductRow>(
        `UPDATE work_products.work_products
          SET status = 'archived',
              submitted_revision_id = NULL,
              archived_at = now(),
              updated_at = now()
        WHERE organization_id = app.current_org_id()
          AND id = $1::uuid
          AND status <> 'archived'
       RETURNING ${workProductColumns}`,
        [workProductId],
      ),
    );

    const row = result.rows[0];

    return row === undefined ? null : mapWorkProduct(row);
  }
}

export const pgWorkProductStore = new PgWorkProductStore();
