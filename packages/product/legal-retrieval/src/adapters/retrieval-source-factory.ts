import type { AuthzContext } from '@legalintel/iam';

import type {
  WorkProductRevisionSourceReader,
} from '@legalintel/work-products';

import {
  createAuthorizedRetrievalSource,
} from './authorized-source-adapter.js';

import type {
  RetrievalCandidateStore,
} from '../ports/retrieval-candidate-store.js';

import type {
  RetrievalSourcePort,
} from '../ports/retrieval-source.js';

export interface RetrievalSourceFactoryInput {
  readonly context: AuthzContext;
  readonly sourceReader: WorkProductRevisionSourceReader;
  readonly candidateStore: RetrievalCandidateStore;
}

export function createRetrievalSources(
  input: RetrievalSourceFactoryInput,
): readonly RetrievalSourcePort[] {
  const dependencies = {
    context: input.context,
    sourceReader: input.sourceReader,
    candidateStore: input.candidateStore,
  };

  return Object.freeze([
    createAuthorizedRetrievalSource(
      'corpus_document_version',
      dependencies,
    ),

    createAuthorizedRetrievalSource(
      'knowledge_source_version',
      dependencies,
    ),

    createAuthorizedRetrievalSource(
      'matter_document_version',
      dependencies,
    ),
  ]);
}
