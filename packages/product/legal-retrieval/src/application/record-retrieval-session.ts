import {
  recordAuditEvent,
} from '@legalintel/audit';

import type {
  Tx,
} from '@legalintel/db';

import type {
  AuthzContext,
} from '@legalintel/iam';

import type {
  RetrievalResult,
} from '../domain/retrieval.js';

import type {
  RetrievalSessionRecord,
  RetrievalSessionStore,
} from '../ports/retrieval-session-store.js';

function human(
  context: AuthzContext,
): string {
  if (
    context.principal.kind
      !== 'user'
  ) {
    throw new Error(
      'retrieval.session_user_required',
    );
  }

  return context.principal.userId;
}

/**
 * Persist immutable retrieval provenance and its audit event in the same tenant
 * transaction.
 *
 * Privacy boundary:
 *
 * audit metadata contains only IDs/counts/versions/fingerprint.
 * Neither raw query text nor normalized query text nor excerpts are written.
 */
export async function recordRetrievalSession(
  store: RetrievalSessionStore,
  tx: Tx,
  context: AuthzContext,
  input: {
    readonly id: string;
    readonly result: RetrievalResult;
  },
): Promise<RetrievalSessionRecord> {
  const actorId =
    human(context);

  const scope =
    input.result.scope;

  if (
    context.organizationId
      !== scope.organizationId
  ) {
    throw new Error(
      'retrieval.session_scope_denied',
    );
  }

  const recorded =
    await store.record(
      tx,
      {
        id: input.id,
        organizationId:
          scope.organizationId,
        taskId:
          scope.taskId,
        taskScopeRevision:
          scope.taskScopeRevision,
        jurisdictionId:
          scope.jurisdictionId,
        matterId:
          scope.matterId,
        scopeMode:
          scope.scopeMode,
        query:
          input.result.query,
        evidence:
          input.result.evidence,
        createdBy:
          actorId,
      },
    );

  const counts =
    input.result.evidence.reduce(
      (
        value,
        evidence,
      ) => {
        value[
          evidence.source.kind
        ] += 1;

        return value;
      },
      {
        corpus_document_version: 0,
        knowledge_source_version: 0,
        matter_document_version: 0,
      },
    );

  await recordAuditEvent(
    tx,
    {
      actorKind:
        'user',
      actorId,
      action:
        'legal_retrieval.session_recorded',
      outcome:
        'success',
      resourceType:
        'legal_retrieval_session',
      resourceId:
        recorded.id,
      metadata: {
        task_id:
          recorded.taskId,
        task_scope_revision:
          recorded.taskScopeRevision,
        query_fingerprint:
          recorded.queryFingerprint,
        result_count:
          recorded.resultCount,
        corpus_count:
          counts.corpus_document_version,
        knowledge_count:
          counts.knowledge_source_version,
        matter_document_count:
          counts.matter_document_version,
      },
    },
  );

  return recorded;
}
