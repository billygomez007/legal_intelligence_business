const MAX_DERIVED_QUERY_BYTES = 1_024;

const MAX_DERIVED_QUERY_TERMS = 24;

/**
 * Query-only boilerplate.
 *
 * These words may help a person phrase a question but generally do not help
 * PostgreSQL lexical retrieval locate the legal authority being asked about.
 *
 * IMPORTANT:
 * - this list never changes authorization;
 * - it never chooses sources;
 * - it never chooses jurisdictions;
 * - it never chooses Matters;
 * - it never fabricates legal terminology.
 */
const QUERY_BOILERPLATE = new Set([
  'a',
  'about',
  'according',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'can',
  'could',
  'do',
  'does',
  'for',
  'from',
  'ghana',
  'ghanaian',
  'has',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'law',
  'legal',
  'me',
  'of',
  'on',
  'or',
  'please',
  'say',
  'says',
  'tell',
  'that',
  'the',
  'this',
  'to',
  'under',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'would',
]);

function normalizeQuestion(question: string): string {
  return question.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function tokenize(question: string): readonly string[] {
  /**
   * Keep letters, numbers, apostrophes and internal hyphens.
   *
   * Unicode letters are retained so this remains safe for names and future
   * multilingual Ghana legal material.
   */
  return question.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function fitUtf8(tokens: readonly string[]): string {
  const accepted: string[] = [];

  for (const token of tokens.slice(0, MAX_DERIVED_QUERY_TERMS)) {
    const next = [...accepted, token].join(' ');

    if (Buffer.byteLength(next, 'utf8') > MAX_DERIVED_QUERY_BYTES) {
      break;
    }

    accepted.push(token);
  }

  return accepted.join(' ');
}

/**
 * Convert a normal user research question into a bounded lexical retrieval
 * query.
 *
 * Example:
 *
 *   "What does Ghanaian law say about equitable estoppel?"
 *
 * becomes:
 *
 *   "equitable estoppel"
 *
 * This is deliberately deterministic and provider-free.
 *
 * The original question must still be retained separately for the grounded
 * research packet and synthesis provider.
 */
export function deriveLegalRetrievalQuery(question: string): string {
  const normalized = normalizeQuestion(question);

  if (normalized.length === 0) {
    return normalized;
  }

  const tokens = tokenize(normalized);

  const substantive = tokens.filter((token) => !QUERY_BOILERPLATE.has(token));

  const derived = fitUtf8(substantive);

  if (derived.length > 0) {
    return derived;
  }

  /**
   * Fail useful, not broad:
   *
   * If the entire question is boilerplate, retain a bounded normalized
   * representation rather than manufacturing search concepts.
   */
  return fitUtf8(tokens);
}

export const researchQueryLimits = Object.freeze({
  maxBytes: MAX_DERIVED_QUERY_BYTES,

  maxTerms: MAX_DERIVED_QUERY_TERMS,
});
