import type { Tx } from '@legalintel/db';
import type { AuthzContext } from '@legalintel/iam';

import type {
  WorkProductRevisionSourceReader,
  WorkProductScopeAuthorization,
  WorkProductSourceReference,
} from '../ports/revision-source-reader.js';

import { createCorpusWorkProductSourceReader } from './corpus-source-reader.js';

import {
  createPrivateWorkProductSourceReader,
  type PrivateWorkProductSourceDependencies,
} from './private-source-reader.js';

export function createWorkProductSourceReader(
  tx: Tx,
  dependencies: PrivateWorkProductSourceDependencies,
): WorkProductRevisionSourceReader {
  const privateReader = createPrivateWorkProductSourceReader(tx, dependencies);

  const corpusReader = createCorpusWorkProductSourceReader(tx, dependencies.taskAccess);

  return Object.freeze({
    readScope: (context: AuthzContext, taskId: string, revision: number) =>
      privateReader.readScope(context, taskId, revision),

    async readSource(
      context: AuthzContext,
      scope: WorkProductScopeAuthorization,
      reference: WorkProductSourceReference,
    ) {
      if (reference.kind === 'corpus_document_version') {
        return corpusReader.readSource(context, scope, reference);
      }

      return privateReader.readSource(context, scope, reference);
    },
  });
}
