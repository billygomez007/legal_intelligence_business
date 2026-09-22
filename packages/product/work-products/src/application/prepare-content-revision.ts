import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { AuthzContext } from '@legalintel/iam';
import { requireWorkProductPermission } from '../authz/require-permission.js';
import {
  addReviewRevision,
  createReviewState,
  WorkProductPolicyError,
  type WorkProductReviewState,
} from '../domain/review-policy.js';
import type {
  WorkProductRevisionSourceReader,
  WorkProductSourceReference,
} from '../ports/revision-source-reader.js';

export const MAX_WORK_PRODUCT_CONTENT_BYTES = 1_048_576;
export const MAX_WORK_PRODUCT_REFERENCES = 100;

export interface WorkProductRevisionInput {
  readonly id: string;
  readonly workProductId: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskScopeRevision: number;
  readonly matterId: string | null;
  readonly content: string;
  readonly format: 'plain_text' | 'markdown';
  readonly provenance: readonly WorkProductSourceReference[];
}

export interface WorkProductContentRevision extends WorkProductRevisionInput {
  readonly countryCode: 'GH';
  readonly number: number;
  readonly previousRevisionId: string | null;
  readonly authorUserId: string;
  readonly contentSha256: string;
  readonly revisionSha256: string;
}

export interface PreparedWorkProductRevision {
  readonly revision: WorkProductContentRevision;
  readonly state: WorkProductReviewState;
}

function deny(code: string): never {
  throw new WorkProductPolicyError('work_product.' + code);
}

function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    deny('invalid_identifier');
  }
}

function text(value: unknown, limit: number): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > limit ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  ) {
    deny('invalid_text');
  }
}

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fingerprint(r: Omit<WorkProductContentRevision, 'revisionSha256'>): string {
  return sha(
    JSON.stringify([
      'lawafrique.work-product-revision.v2',
      r.id,
      r.workProductId,
      r.organizationId,
      r.taskId,
      r.taskScopeRevision,
      r.matterId,
      r.countryCode,
      r.number,
      r.previousRevisionId,
      r.authorUserId,
      r.format,
      r.contentSha256,
      r.provenance.map((p) => [p.kind, p.sourceId, p.versionId, p.locator]),
    ]),
  );
}

/** Copy before awaiting readers, so caller mutation cannot change what is checked. */
function snapshot(input: WorkProductRevisionInput): WorkProductRevisionInput {
  for (const value of [input.id, input.workProductId, input.organizationId, input.taskId])
    id(value);
  if (!Number.isSafeInteger(input.taskScopeRevision) || input.taskScopeRevision < 1) {
    deny('invalid_task_scope_revision');
  }
  if (input.matterId !== null) id(input.matterId);
  text(input.content, MAX_WORK_PRODUCT_CONTENT_BYTES);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate runtime inputs and database results even when their declared types are narrower.
  if (input.format !== 'plain_text' && input.format !== 'markdown') {
    deny('invalid_content_format');
  }
  if (!Array.isArray(input.provenance) || input.provenance.length > MAX_WORK_PRODUCT_REFERENCES) {
    deny('invalid_provenance');
  }
  const seen = new Set<string>();
  const provenance = Array.from(input.provenance, (reference: WorkProductSourceReference) => {
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Reject sparse or malformed runtime source references.
      !reference ||
      !['matter_document_version', 'knowledge_source_version', 'corpus_document_version'].includes(
        reference.kind,
      )
    ) {
      deny('invalid_provenance');
    }
    id(reference.sourceId);
    id(reference.versionId);
    if (reference.locator !== null) text(reference.locator, 512);
    const copied = Object.freeze({
      kind: reference.kind,
      sourceId: reference.sourceId,
      versionId: reference.versionId,
      locator: reference.locator,
    });
    const key = JSON.stringify(copied);
    if (seen.has(key)) deny('duplicate_provenance');
    seen.add(key);
    return copied;
  });
  return Object.freeze({
    id: input.id,
    workProductId: input.workProductId,
    organizationId: input.organizationId,
    taskId: input.taskId,
    taskScopeRevision: input.taskScopeRevision,
    matterId: input.matterId,
    content: input.content,
    format: input.format,
    provenance: Object.freeze(provenance),
  });
}

/**
 * Prepare only: no database write, transaction, timestamp, or audit is performed.
 * context, input ownership, and previous must be server-resolved, not client state.
 * Source-reader results are checked, but unit fixtures are not live source access.
 */
export async function prepareWorkProductContentRevision(
  reader: WorkProductRevisionSourceReader,
  context: AuthzContext,
  input: WorkProductRevisionInput,
  previous:
    | (PreparedWorkProductRevision & {
        readonly expectedRevisionId: string;
      })
    | null = null,
): Promise<PreparedWorkProductRevision> {
  const authorUserId = requireWorkProductPermission(
    context,
    input.organizationId,
    previous === null ? 'work_product:create' : 'work_product:revise',
  );
  const copied = snapshot(input);
  let number = 1;
  let previousRevisionId: string | null = null;
  let state: WorkProductReviewState;

  if (previous === null) {
    state = createReviewState(copied.id);
  } else {
    const old = previous.revision;
    if (
      old.organizationId !== copied.organizationId ||
      old.workProductId !== copied.workProductId ||
      old.taskId !== copied.taskId ||
      old.matterId !== copied.matterId ||
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate runtime inputs and database results even when their declared types are narrower.
      old.countryCode !== 'GH' ||
      old.id !== previous.state.currentRevisionId ||
      !Number.isSafeInteger(old.number) ||
      old.number < 1 ||
      old.number >= Number.MAX_SAFE_INTEGER ||
      old.contentSha256 !== sha(old.content) ||
      old.revisionSha256 !== fingerprint(old)
    ) {
      deny('previous_revision_mismatch');
    }
    state = addReviewRevision(previous.state, previous.expectedRevisionId, copied.id);
    number = old.number + 1;
    previousRevisionId = old.id;
  }

  const foundScope = await reader.readScope(context, copied.taskId, copied.taskScopeRevision);
  if (
    foundScope?.permitted !== true ||
    foundScope.organizationId !== copied.organizationId ||
    foundScope.taskId !== copied.taskId ||
    foundScope.taskScopeRevision !== copied.taskScopeRevision ||
    foundScope.matterId !== copied.matterId ||
    foundScope.countryCode !== 'GH' ||
    foundScope.taskStatus !== 'ready'
  ) {
    deny('task_scope_unavailable');
  }
  const scope = Object.freeze({ ...foundScope });
  for (const reference of copied.provenance) {
    const source = await reader.readSource(context, scope, reference);
    if (
      source?.permitted !== true ||
      source.kind !== reference.kind ||
      source.sourceId !== reference.sourceId ||
      source.versionId !== reference.versionId
    ) {
      deny('source_unavailable');
    }
    if (reference.kind === 'corpus_document_version') {
      if (source.organizationId !== null || source.matterId !== null || source.countryCode !== 'GH')
        deny('source_unavailable');
    } else {
      if (
        source.organizationId !== copied.organizationId ||
        (source.countryCode !== null && source.countryCode !== 'GH') ||
        (reference.kind === 'knowledge_source_version' && source.matterId !== null) ||
        (reference.kind === 'matter_document_version' &&
          (copied.matterId === null || source.matterId !== copied.matterId))
      ) {
        deny('source_unavailable');
      }
    }
  }
  const revision = {
    ...copied,
    countryCode: 'GH' as const,
    number,
    previousRevisionId,
    authorUserId,
    contentSha256: sha(copied.content),
  };
  return Object.freeze({
    revision: Object.freeze({ ...revision, revisionSha256: fingerprint(revision) }),
    state,
  });
}
