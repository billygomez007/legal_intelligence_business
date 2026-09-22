import type {
  AuthzContext,
} from '@legalintel/iam';

import type {
  GroundedResearchPacket,
} from '@legalintel/legal-retrieval';

/**
 * Trusted Phase 8 research boundary for Phase 9.
 *
 * IMPORTANT:
 *
 * The caller supplies only:
 *
 * - authenticated IAM context;
 * - AI Task ID;
 * - research question;
 * - optional bounded result limit.
 *
 * The caller does NOT supply:
 *
 * - organization ID;
 * - jurisdiction ID;
 * - jurisdiction code;
 * - task-scope revision;
 * - matter ID;
 * - scope mode;
 * - source IDs;
 * - version IDs.
 *
 * A production implementation must resolve those values from the current
 * authorized AI Task and its immutable scope revision before retrieval.
 */
export interface TaskAuthorizedResearchRequest {
  readonly context:
    AuthzContext;

  readonly taskId:
    string;

  readonly question:
    string;

  readonly limit?:
    number;
}

export interface TaskAuthorizedResearch {
  research(
    request:
      TaskAuthorizedResearchRequest,
  ): Promise<GroundedResearchPacket>;
}
