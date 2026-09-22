import type { AuthzContext } from '@legalintel/iam';

export type WorkProductSourceKind =
  'matter_document_version' | 'knowledge_source_version' | 'corpus_document_version';

export interface WorkProductSourceReference {
  readonly kind: WorkProductSourceKind;
  readonly sourceId: string;
  readonly versionId: string;
  readonly locator: string | null;
}

export interface WorkProductScopeAuthorization {
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskScopeRevision: number;
  readonly matterId: string | null;
  readonly countryCode: string;
  readonly taskStatus: string;
  readonly permitted: boolean;
}

export interface WorkProductSourceAuthorization {
  readonly kind: WorkProductSourceKind;
  readonly sourceId: string;
  readonly versionId: string;
  readonly organizationId: string | null;
  readonly matterId: string | null;
  readonly countryCode: string | null;
  readonly permitted: boolean;
}

/**
 * Server-only port. Its database adapter must resolve real records, current IAM
 * access, Ghana entitlements, selected task scope, and applicable source rights.
 * Bind it to the same transaction that persists the revision and audit events.
 * Never construct these authorizations from client-supplied ownership or flags.
 * No default or production adapter is provided in this increment.
 */
export interface WorkProductRevisionSourceReader {
  readScope(
    context: AuthzContext,
    taskId: string,
    taskScopeRevision: number,
  ): Promise<WorkProductScopeAuthorization | null>;

  readSource(
    context: AuthzContext,
    scope: WorkProductScopeAuthorization,
    reference: WorkProductSourceReference,
  ): Promise<WorkProductSourceAuthorization | null>;
}
