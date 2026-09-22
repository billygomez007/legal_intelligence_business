import type { Tx } from '@legalintel/db';

import type {
  RetrievalSessionRecord,
  RetrievalSessionRecordInput,
  RetrievalSessionStore,
} from '../ports/retrieval-session-store.js';

interface SessionRow {
  readonly id: string;
  readonly organization_id: string;
  readonly task_id: string;
  readonly task_scope_revision: number;
  readonly jurisdiction_id: string;
  readonly matter_id: string | null;
  readonly scope_mode: string;
  readonly query_fingerprint: string;
  readonly requested_limit: number;
  readonly result_count: number;
  readonly created_by: string;
}

function map(
  row: SessionRow,
): RetrievalSessionRecord {
  return Object.freeze({
    id: row.id,
    organizationId:
      row.organization_id,
    taskId:
      row.task_id,
    taskScopeRevision:
      row.task_scope_revision,
    jurisdictionId:
      row.jurisdiction_id,
    matterId:
      row.matter_id,
    scopeMode:
      row.scope_mode,
    queryFingerprint:
      row.query_fingerprint,
    requestedLimit:
      row.requested_limit,
    resultCount:
      row.result_count,
    createdBy:
      row.created_by,
  });
}

export const pgRetrievalSessionStore:
  RetrievalSessionStore<Tx> = {
    async record(
      tx: Tx,
      input: RetrievalSessionRecordInput,
    ): Promise<RetrievalSessionRecord> {
      const session =
        await tx.query<SessionRow>(
          `
            INSERT INTO legal_retrieval.sessions (
              organization_id,
              id,
              task_id,
              task_scope_revision,
              jurisdiction_id,
              matter_id,
              scope_mode,
              query_fingerprint,
              requested_limit,
              result_count,
              created_by
            )
            VALUES (
              app.current_org_id(),
              $1::uuid,
              $2::uuid,
              $3,
              $4::uuid,
              $5::uuid,
              $6,
              $7,
              $8,
              $9,
              $10::uuid
            )
            RETURNING
              id::text,
              organization_id::text,
              task_id::text,
              task_scope_revision,
              jurisdiction_id::text,
              matter_id::text,
              scope_mode,
              query_fingerprint,
              requested_limit,
              result_count,
              created_by::text
          `,
          [
            input.id,
            input.taskId,
            input.taskScopeRevision,
            input.jurisdictionId,
            input.matterId,
            input.scopeMode,
            input.query.fingerprint,
            input.query.limit,
            input.evidence.length,
            input.createdBy,
          ],
        );

      const row =
        session.rows[0];

      if (
        row === undefined
        || row.organization_id
          !== input.organizationId
      ) {
        throw new Error(
          'retrieval.session_persistence_failed',
        );
      }

      for (
        let ordinal = 0;
        ordinal < input.evidence.length;
        ordinal += 1
      ) {
        const evidence =
          input.evidence[ordinal];

        if (
          evidence === undefined
        ) {
          throw new Error(
            'retrieval.session_evidence_invalid',
          );
        }

        await tx.query(
          `
            INSERT INTO legal_retrieval.session_evidence (
              organization_id,
              session_id,
              ordinal,
              source_kind,
              source_id,
              version_id,
              passage_id,
              locator,
              content_sha256
            )
            VALUES (
              app.current_org_id(),
              $1::uuid,
              $2,
              $3,
              $4::uuid,
              $5::uuid,
              $6::uuid,
              $7,
              $8
            )
          `,
          [
            input.id,
            ordinal,
            evidence.source.kind,
            evidence.source.sourceId,
            evidence.source.versionId,
            evidence.passage?.passageId
              ?? null,
            evidence.passage?.locator
              ?? null,
            evidence.passage?.contentHash
              ?? null,
          ],
        );
      }

      return map(row);
    },
  };
