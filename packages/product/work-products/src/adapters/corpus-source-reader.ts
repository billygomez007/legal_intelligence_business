import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import { requireWorkProductPermission } from '../authz/require-permission.js';

import type {
  WorkProductRevisionSourceReader,
  WorkProductScopeAuthorization,
  WorkProductSourceAuthorization,
  WorkProductSourceReference,
} from '../ports/revision-source-reader.js';

import {
  readAuthorizedWorkProductTaskScope,
  type WorkProductTaskScopeAccess,
} from './pg-task-scope-access.js';

interface CorpusVersionRow {
  readonly version_id: string;
  readonly document_id: string;
  readonly jurisdiction_id: string;
  readonly lifecycle_state: string;
  readonly ai_allowed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authorizes an exact Ghana corpus version for Work Product provenance.
 *
 * sourceId is the stable legal-document ID.
 * versionId is the exact immutable document-version ID.
 *
 * Rights are evaluated by corpus.source_allows(), whose database-owned
 * implementation applies effective dates, expiry, denial and revocation.
 */
export function createCorpusWorkProductSourceReader(
  tx: Tx,
  taskAccess?: WorkProductTaskScopeAccess,
): WorkProductRevisionSourceReader {
  const readScope: WorkProductRevisionSourceReader['readScope'] = (
    context,
    taskId,
    taskScopeRevision,
  ) => readAuthorizedWorkProductTaskScope(tx, context, taskId, taskScopeRevision, taskAccess);

  return Object.freeze({
    readScope,

    async readSource(
      context: AuthzContext,
      suppliedScope: WorkProductScopeAuthorization,
      reference: WorkProductSourceReference,
    ): Promise<WorkProductSourceAuthorization | null> {
      requireWorkProductPermission(context, suppliedScope.organizationId, 'work_product:read');

      if (
        reference.kind !== 'corpus_document_version' ||
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- Validate runtime inputs and database results even when their declared types are narrower.
        suppliedScope.permitted !== true ||
        suppliedScope.countryCode !== 'GH' ||
        suppliedScope.taskStatus !== 'ready'
      ) {
        return null;
      }

      const sourceId = reference.sourceId;
      const versionId = reference.versionId;

      if (!UUID.test(sourceId) || !UUID.test(versionId)) {
        return null;
      }

      const currentScope = await readAuthorizedWorkProductTaskScope(
        tx,
        context,
        suppliedScope.taskId,
        suppliedScope.taskScopeRevision,
        taskAccess,
      );

      if (
        currentScope?.organizationId !== suppliedScope.organizationId ||
        currentScope.taskId !== suppliedScope.taskId ||
        currentScope.taskScopeRevision !== suppliedScope.taskScopeRevision ||
        currentScope.matterId !== suppliedScope.matterId ||
        currentScope.countryCode !== 'GH'
      ) {
        return null;
      }

      const result = await tx.query<CorpusVersionRow>(
        `SELECT
           dv.id::text AS version_id,
           dv.document_id::text AS document_id,
           dv.jurisdiction_id::text AS jurisdiction_id,
           dv.lifecycle_state::text AS lifecycle_state,
           corpus.source_allows(
             dv.source_id,
             'ai_processing'
           ) AS ai_allowed
         FROM corpus.document_versions AS dv
         WHERE dv.id = $1::uuid
           AND dv.document_id = $2::uuid
           AND dv.jurisdiction_id = $3::uuid`,
        [versionId, sourceId, currentScope.jurisdictionId],
      );

      if (result.rows.length !== 1) {
        return null;
      }

      const row = result.rows[0];

      if (
        row?.version_id !== versionId ||
        row.document_id !== sourceId ||
        row.jurisdiction_id !== currentScope.jurisdictionId ||
        row.lifecycle_state !== 'published' ||
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- Validate runtime inputs and database results even when their declared types are narrower.
        row.ai_allowed !== true
      ) {
        return null;
      }

      return Object.freeze({
        kind: 'corpus_document_version',
        sourceId,
        versionId,
        organizationId: null,
        matterId: null,
        countryCode: 'GH',
        permitted: true,
      });
    },
  });
}
