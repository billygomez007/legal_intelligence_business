import type {
  AuthorizedRetrievalScope,
  GroundedResearchPacket,
  RetrievalEvidence,
} from '../domain/retrieval.js';

export function buildGroundedResearchPacket(
  input: {
    readonly question: string;
    readonly scope: AuthorizedRetrievalScope;
    readonly evidence: readonly RetrievalEvidence[];
    readonly unresolvedIssues?: readonly string[];
  },
): GroundedResearchPacket {
  const unresolvedIssues =
    Object.freeze([
      ...(input.unresolvedIssues ?? []),
    ]);

  return Object.freeze({
    question: input.question,
    scope: Object.freeze({
      ...input.scope,
    }),
    evidence: Object.freeze([
      ...input.evidence,
    ]),
    unresolvedIssues,
    insufficientEvidence:
      input.evidence.length === 0,
  });
}
