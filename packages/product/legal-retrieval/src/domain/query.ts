import { createHash } from 'node:crypto';

import type {
  RetrievalQuery,
} from './retrieval.js';

export const MAX_RETRIEVAL_QUERY_BYTES = 8_192;
export const DEFAULT_RETRIEVAL_LIMIT = 10;
export const MAX_RETRIEVAL_LIMIT = 50;

export class RetrievalQueryError extends Error {
  constructor(
    readonly code:
      | 'retrieval.query_empty'
      | 'retrieval.query_too_large'
      | 'retrieval.query_null_byte'
      | 'retrieval.limit_invalid',
  ) {
    super(code);
    this.name = 'RetrievalQueryError';
  }
}

export function normalizeRetrievalQuery(
  text: string,
): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function prepareRetrievalQuery(
  input: {
    readonly text: string;
    readonly limit?: number;
  },
): RetrievalQuery {
  if (input.text.includes('\0')) {
    throw new RetrievalQueryError(
      'retrieval.query_null_byte',
    );
  }

  const normalizedText =
    normalizeRetrievalQuery(input.text);

  if (normalizedText.length === 0) {
    throw new RetrievalQueryError(
      'retrieval.query_empty',
    );
  }

  if (
    Buffer.byteLength(
      normalizedText,
      'utf8',
    ) > MAX_RETRIEVAL_QUERY_BYTES
  ) {
    throw new RetrievalQueryError(
      'retrieval.query_too_large',
    );
  }

  const limit =
    input.limit
    ?? DEFAULT_RETRIEVAL_LIMIT;

  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_RETRIEVAL_LIMIT
  ) {
    throw new RetrievalQueryError(
      'retrieval.limit_invalid',
    );
  }

  const fingerprint = createHash('sha256')
    .update(
      'law-afrique-retrieval-query-v1\0',
      'utf8',
    )
    .update(normalizedText, 'utf8')
    .digest('hex');

  return Object.freeze({
    text: input.text,
    normalizedText,
    fingerprint,
    limit,
  });
}
