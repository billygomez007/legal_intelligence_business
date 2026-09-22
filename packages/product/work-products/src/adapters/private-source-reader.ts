import type { Tx } from '@legalintel/db';
import { enforce } from '@legalintel/iam';
import {
  KnowledgeSourceId,
  KnowledgeSourceVersionId,
  type KnowledgeStore,
} from '@legalintel/knowledge';
import {
  MatterDocumentId,
  MatterDocumentVersionId,
  type MatterDocumentStore,
} from '@legalintel/matter-documents';
import { requireWorkProductPermission } from '../authz/require-permission.js';
import type {
  WorkProductRevisionSourceReader,
  WorkProductSourceReference,
} from '../ports/revision-source-reader.js';
import {
  readAuthorizedWorkProductTaskScope,
  type WorkProductTaskScopeAccess,
} from './pg-task-scope-access.js';

/** Supply existing server-side stores; never accept implementations from a request. */
export interface PrivateWorkProductSourceDependencies {
  readonly knowledgeStore: Pick<KnowledgeStore<Tx>, 'findSource' | 'listSourceVersions'>;
  readonly matterDocumentStore: Pick<
    MatterDocumentStore<Tx>,
    'findDocument' | 'listDocumentVersions'
  >;
  readonly taskAccess?: WorkProductTaskScopeAccess;
}

const knowledgeModes = new Set([
  'ghana_corpus_and_firm_knowledge',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);
const matterModes = new Set([
  'ghana_corpus_and_matter',
  'ghana_corpus_and_matter_and_firm_knowledge',
]);

/**
 * Metadata-only source authorization using the caller's tenant transaction.
 * Reauthorizes the task on every source read; does not trust a supplied scope grant.
 * Corpus references are denied until the real corpus-rights reader is connected.
 * No document bytes, storage keys, writes, locks, or external calls are performed.
 */
export function createPrivateWorkProductSourceReader(
  tx: Tx,
  dependencies: PrivateWorkProductSourceDependencies,
): WorkProductRevisionSourceReader {
  const { knowledgeStore, matterDocumentStore, taskAccess } = dependencies;
  const readScope: WorkProductRevisionSourceReader['readScope'] = (context, taskId, revision) =>
    readAuthorizedWorkProductTaskScope(tx, context, taskId, revision, taskAccess);

  return Object.freeze({
    readScope,
    async readSource(context, supplied, reference) {
      const requested = Object.freeze({
        organizationId: supplied.organizationId,
        taskId: supplied.taskId,
        taskScopeRevision: supplied.taskScopeRevision,
        matterId: supplied.matterId,
        countryCode: supplied.countryCode,
        taskStatus: supplied.taskStatus,
        permitted: supplied.permitted,
      });
      requireWorkProductPermission(context, requested.organizationId, 'work_product:read');
      if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate runtime inputs and database results even when their declared types are narrower.
        !reference ||
        (reference.kind !== 'knowledge_source_version' &&
          reference.kind !== 'matter_document_version')
      )
        return null;
      const ref: WorkProductSourceReference = Object.freeze({
        kind: reference.kind,
        sourceId: reference.sourceId,
        versionId: reference.versionId,
        locator: reference.locator,
      });
      if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- Validate runtime inputs and database results even when their declared types are narrower.
        requested.permitted !== true ||
        requested.countryCode !== 'GH' ||
        requested.taskStatus !== 'ready'
      )
        return null;

      // The fresh result includes the mode from the actual stored task.
      const scope = await readAuthorizedWorkProductTaskScope(
        tx,
        context,
        requested.taskId,
        requested.taskScopeRevision,
        taskAccess,
      );
      if (
        scope?.organizationId !== requested.organizationId ||
        scope.matterId !== requested.matterId
      )
        return null;

      if (ref.kind === 'knowledge_source_version') {
        if (!knowledgeModes.has(scope.scopeMode)) return null;
        enforce(context, 'knowledge:source:read');
        enforce(context, 'knowledge:version:read');
        let sourceId: KnowledgeSourceId;
        let versionId: KnowledgeSourceVersionId;
        try {
          sourceId = KnowledgeSourceId.parse(ref.sourceId);
          versionId = KnowledgeSourceVersionId.parse(ref.versionId);
        } catch {
          return null; // Parse failure only; store and authorization errors propagate.
        }
        const source = await knowledgeStore.findSource(tx, sourceId);
        if (
          source?.id !== sourceId ||
          source.organizationId !== scope.organizationId ||
          source.status !== 'active'
        )
          return null;
        const versions = await knowledgeStore.listSourceVersions(tx, sourceId);
        const matching = versions.filter((item) => item.id === versionId);
        const version = matching[0];
        if (
          matching.length !== 1 ||
          version?.sourceId !== sourceId ||
          version.organizationId !== scope.organizationId
        )
          return null;
        return Object.freeze({
          kind: ref.kind,
          sourceId: ref.sourceId,
          versionId: ref.versionId,
          organizationId: scope.organizationId,
          matterId: null,
          countryCode: null,
          permitted: true,
        });
      }

      if (!matterModes.has(scope.scopeMode) || scope.matterId === null) return null;
      enforce(context, 'matter:read');
      enforce(context, 'matter-document:read');
      enforce(context, 'matter-document:version:read');
      let documentId: MatterDocumentId;
      let versionId: MatterDocumentVersionId;
      try {
        documentId = MatterDocumentId.parse(ref.sourceId);
        versionId = MatterDocumentVersionId.parse(ref.versionId);
      } catch {
        return null;
      }
      const document = await matterDocumentStore.findDocument(tx, documentId);
      if (
        document?.id !== documentId ||
        document.organizationId !== scope.organizationId ||
        document.status !== 'active' ||
        document.matterId !== scope.matterId
      )
        return null;
      const versions = await matterDocumentStore.listDocumentVersions(tx, documentId);
      const matching = versions.filter((item) => item.id === versionId);
      const version = matching[0];
      if (
        matching.length !== 1 ||
        version?.documentId !== documentId ||
        version.organizationId !== scope.organizationId ||
        version.matterId !== scope.matterId
      )
        return null;
      return Object.freeze({
        kind: ref.kind,
        sourceId: ref.sourceId,
        versionId: ref.versionId,
        organizationId: scope.organizationId,
        matterId: scope.matterId,
        countryCode: 'GH',
        permitted: true,
      });
    },
  } satisfies WorkProductRevisionSourceReader);
}
