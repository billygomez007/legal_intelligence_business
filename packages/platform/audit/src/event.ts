import { SENSITIVE_FIELD_NAMES } from '@legalintel/observability';
import { validationError } from '@legalintel/kernel';

export type AuditActorKind = 'user' | 'api_key' | 'system';
export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditEvent {
  readonly actorKind: AuditActorKind;
  readonly actorId?: string;
  /** Dotted, lowercase: `member.removed`, `api_key.issued`, `corpus.published`. */
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly requestId?: string;
  /** Identifiers, counts, versions and outcomes. Never content. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const ACTION = /^[a-z][a-z0-9_.:-]{0,98}[a-z0-9]$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_STRING = 256;
const MAX_DEPTH = 4;
const MAX_BYTES = 4000; // Below the database's 4096 limit, with headroom for JSONB overhead.

const SENSITIVE = new Set(SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()));

const reject = (message: string) => validationError('audit.invalid_event', message);

function checkValue(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) throw reject(`Metadata at "${path}" is nested too deeply.`);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    // A long string is almost always content (a quoted passage, a query). Identifiers and
    // outcomes are short. This is a structural backstop against logging document text.
    if (value.length > MAX_STRING) {
      throw reject(
        `Metadata "${path}" is a string longer than ${MAX_STRING} characters; audit records must not carry content.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      checkValue(item, `${path}[${index}]`, depth + 1);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE.has(key.toLowerCase())) {
        throw reject(
          `Metadata key "${path}.${key}" is a sensitive field name. Record an identifier instead of content.`,
        );
      }
      checkValue(child, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw reject(`Metadata "${path}" has an unsupported value type.`);
}

/**
 * Structural validation applied before anything is written. The database re-checks format and
 * size; the parts only code can check (no content, no sensitive field names) live here.
 */
export function validateAuditEvent(event: AuditEvent): void {
  if (!ACTION.test(event.action)) {
    throw reject('Audit action must be lowercase dotted words, e.g. "member.removed".');
  }
  if (event.resourceType !== undefined && !RESOURCE_TYPE.test(event.resourceType)) {
    throw reject('Audit resourceType must be lowercase snake_case.');
  }
  for (const [name, value] of [
    ['actorId', event.actorId],
    ['resourceId', event.resourceId],
    ['requestId', event.requestId],
  ] as const) {
    if (value !== undefined && value.length > 128) throw reject(`Audit ${name} is too long.`);
  }
  if (event.metadata !== undefined) {
    checkValue(event.metadata, 'metadata', 0);
    if (Buffer.byteLength(JSON.stringify(event.metadata), 'utf8') > MAX_BYTES) {
      throw reject('Audit metadata is too large.');
    }
  }
}
