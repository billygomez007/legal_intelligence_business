import { PgAiTaskStore } from '@legalintel/ai-tasks';

import { withTenantTransaction } from '@legalintel/db';

import { PgKnowledgeStore } from '@legalintel/knowledge';

import { PgMatterDocumentStore } from '@legalintel/matter-documents';

import {
  authorizeRetrievalScope,
  buildGroundedResearchPacket,
  CompositeRetrievalCandidateStore,
  createRetrievalSources,
  PgCorpusRetrievalCandidateStore,
  PgPrivateRetrievalCandidateStore,
  retrieveLegalEvidence,
  type AuthorizedRetrievalScope,
  type RetrievalSourceKind,
  type RetrievalSourcePort,
} from '@legalintel/legal-retrieval';

import { createWorkProductSourceReader } from '@legalintel/work-products';

import { deriveLegalRetrievalQuery } from '../domain/research-query.js';

import type {
  TaskAuthorizedResearch,
  TaskAuthorizedResearchRequest,
} from '../ports/task-authorized-research.js';

type TenantPool = Parameters<typeof withTenantTransaction>[0];

const GHANA_CORPUS: RetrievalSourceKind = 'corpus_document_version';

const FIRM_KNOWLEDGE: RetrievalSourceKind = 'knowledge_source_version';

const MATTER_DOCUMENT: RetrievalSourceKind = 'matter_document_version';

const SOURCE_KINDS_BY_SCOPE_MODE: Readonly<Record<string, readonly RetrievalSourceKind[]>> =
  Object.freeze({
    ghana_corpus: Object.freeze([GHANA_CORPUS]),

    ghana_corpus_and_firm_knowledge: Object.freeze([GHANA_CORPUS, FIRM_KNOWLEDGE]),

    ghana_corpus_and_matter: Object.freeze([GHANA_CORPUS, MATTER_DOCUMENT]),

    ghana_corpus_and_matter_and_firm_knowledge: Object.freeze([
      GHANA_CORPUS,
      FIRM_KNOWLEDGE,
      MATTER_DOCUMENT,
    ]),
  });

function fail(code: string): never {
  throw new Error(`legal_synthesis.${code}`);
}

/**
 * Server-owned mapping from the task's immutable scope mode to the retrieval
 * source kinds allowed to run.
 *
 * The request/client never supplies this list.
 */
export function retrievalSourceKindsForScope(
  scope: AuthorizedRetrievalScope,
): readonly RetrievalSourceKind[] {
  if (scope.countryCode !== 'GH') {
    fail('jurisdiction_not_supported');
  }

  const kinds = SOURCE_KINDS_BY_SCOPE_MODE[scope.scopeMode];

  if (kinds === undefined) {
    fail('scope_mode_unsupported');
  }

  if (kinds.includes(MATTER_DOCUMENT) && scope.matterId === null) {
    fail('matter_scope_missing');
  }

  if (!kinds.includes(MATTER_DOCUMENT) && scope.matterId !== null) {
    fail('matter_scope_unexpected');
  }

  return kinds;
}

function selectAuthorizedSources(
  scope: AuthorizedRetrievalScope,
  sources: readonly RetrievalSourcePort[],
): readonly RetrievalSourcePort[] {
  const permitted = new Set(retrievalSourceKindsForScope(scope));

  const selected = sources.filter((source) => permitted.has(source.kind));

  if (selected.length !== permitted.size) {
    fail('retrieval_source_configuration_invalid');
  }

  return Object.freeze(selected);
}

/**
 * Real Phase 9 task-authorized research adapter.
 *
 * Security flow:
 *
 * authenticated server IAM context
 *   -> tenant transaction
 *   -> current AI Task loaded under RLS
 *   -> server-owned currentScopeRevision
 *   -> Phase 8 authorizeRetrievalScope()
 *   -> Phase 7 exact-source reader
 *   -> scope-mode-limited source set
 *   -> PostgreSQL candidate search
 *   -> exact candidate reauthorization
 *   -> deterministic Phase 8 ranking
 *   -> GroundedResearchPacket
 *
 * No client value is used to construct organization, jurisdiction, matter,
 * task-scope revision or source scope.
 */
export function createPgTaskAuthorizedResearch(pool: TenantPool): TaskAuthorizedResearch {
  const taskStore = new PgAiTaskStore();

  const knowledgeStore = new PgKnowledgeStore();

  const matterDocumentStore = new PgMatterDocumentStore();

  return Object.freeze({
    async research(request: TaskAuthorizedResearchRequest) {
      const organizationId = request.context.organizationId;

      if (organizationId === null || organizationId === undefined) {
        fail('organization_required');
      }

      if (request.context.principal.kind !== 'user') {
        fail('human_actor_required');
      }

      const userId = request.context.principal.userId;

      return withTenantTransaction(
        pool,
        {
          organizationId,
          userId,
        },
        async (tx) => {
          /**
           * Load the CURRENT task through tenant RLS.
           *
           * PgAiTaskStore joins the task to its own current_scope_revision.
           * The client does not provide this revision.
           */
          const task = await taskStore.findTask(tx, request.taskId);

          if (task === null) {
            fail('task_unavailable');
          }

          if (task.organizationId !== String(organizationId)) {
            fail('task_unavailable');
          }

          /**
           * Reuse the accepted Phase 8 / Phase 7 authorization boundary.
           *
           * This revalidates:
           *
           * - current tenant;
           * - task status;
           * - exact current scope revision;
           * - Ghana entitlement;
           * - selected Matter boundary.
           */
          const scope = await authorizeRetrievalScope(
            tx,
            request.context,
            request.taskId,
            task.currentScopeRevision,
          );

          if (scope === null) {
            fail('task_scope_unavailable');
          }

          const sourceReader = createWorkProductSourceReader(tx, {
            knowledgeStore,
            matterDocumentStore,
          });

          const candidateStore = new CompositeRetrievalCandidateStore({
            corpus: new PgCorpusRetrievalCandidateStore(tx),

            privateSources: new PgPrivateRetrievalCandidateStore(tx),
          });

          const configuredSources = createRetrievalSources({
            context: request.context,

            sourceReader,

            candidateStore,
          });

          /**
           * Crucial Phase 9C rule:
           *
           * Do not merely search all source kinds and discard disallowed
           * results later.
           *
           * The server-resolved task scope selects which sources are allowed
           * BEFORE candidate search and ranking.
           */
          const sources = selectAuthorizedSources(scope, configuredSources);

          /**
           * Phase 9I:
           *
           * Keep the user's original question intact for synthesis, but derive
           * a deterministic bounded lexical query for PostgreSQL retrieval.
           *
           * Query derivation cannot alter tenant, task, matter, jurisdiction,
           * source kinds or source IDs.
           */
          const retrievalQuery = deriveLegalRetrievalQuery(request.question);

          const result = await retrieveLegalEvidence(
            request.limit === undefined
              ? {
                  scope,

                  query: retrievalQuery,

                  sources,
                }
              : {
                  scope,

                  query: retrievalQuery,

                  limit: request.limit,

                  sources,
                },
          );

          return buildGroundedResearchPacket({
            question: request.question,

            scope: result.scope,

            evidence: result.evidence,
          });
        },
        {
          readOnly: true,
        },
      );
    },
  });
}
