/**
 * Transport-neutral error taxonomy. Domain and application code throw or return these;
 * the API layer maps `kind` to a status code. Nothing in here knows about HTTP.
 */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'rate_limited'
  | 'unavailable'
  | 'internal';

export interface AppErrorOptions {
  /** Structured, non-sensitive context. Never put document text or personal data here. */
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly kind: ErrorKind;
  /** Stable, machine-readable identifier such as `tenant.context_missing`. */
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(kind: ErrorKind, code: string, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.kind = kind;
    this.code = code;
    this.details = options.details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

export const validationError = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('validation', code, message, options);

export const unauthenticated = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('unauthenticated', code, message, options);

export const forbidden = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('forbidden', code, message, options);

/**
 * Prefer this over `forbidden` when the caller is not allowed to know whether the resource
 * exists. Answering "forbidden" for another tenant's row confirms that the row exists.
 */
export const notFound = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('not_found', code, message, options);

export const conflict = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('conflict', code, message, options);

export const preconditionFailed = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('precondition_failed', code, message, options);

export const unavailable = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('unavailable', code, message, options);

export const internalError = (code: string, message: string, options?: AppErrorOptions) =>
  new AppError('internal', code, message, options);

export interface SafeError {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
}

/**
 * Projects any thrown value onto something safe to return to a caller. Unknown errors and
 * `internal` errors are collapsed to a generic message so that stack traces, SQL text and
 * driver messages never reach an API consumer.
 */
export function toSafeError(error: unknown): SafeError {
  if (isAppError(error) && error.kind !== 'internal') {
    return { kind: error.kind, code: error.code, message: error.message };
  }
  return { kind: 'internal', code: 'internal_error', message: 'An internal error occurred.' };
}
