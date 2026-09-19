import { describe, expect, it } from 'vitest';

import {
  AppError,
  forbidden,
  internalError,
  isAppError,
  notFound,
  toSafeError,
  validationError,
} from '../src';

describe('AppError', () => {
  it('carries kind, code, message and details', () => {
    const error = validationError('doc.title_required', 'Title is required.', {
      details: { field: 'title' },
    });
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
    expect(error.kind).toBe('validation');
    expect(error.code).toBe('doc.title_required');
    expect(error.details).toEqual({ field: 'title' });
  });

  it('preserves the underlying cause for logging', () => {
    const cause = new Error('connection refused');
    const error = internalError('db.unavailable', 'Database unavailable.', { cause });
    expect(error.cause).toBe(cause);
  });

  it('does not treat arbitrary errors as AppError', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError({ kind: 'not_found' })).toBe(false);
  });
});

describe('toSafeError', () => {
  it('passes through client-facing error kinds', () => {
    expect(toSafeError(notFound('project.not_found', 'Project not found.'))).toEqual({
      kind: 'not_found',
      code: 'project.not_found',
      message: 'Project not found.',
    });
    expect(toSafeError(forbidden('authz.denied', 'Not permitted.')).kind).toBe('forbidden');
  });

  it('never leaks the message of an internal AppError', () => {
    const safe = toSafeError(
      internalError('db.query_failed', 'relation "workspace.projects" does not exist'),
    );
    expect(safe).toEqual({
      kind: 'internal',
      code: 'internal_error',
      message: 'An internal error occurred.',
    });
  });

  it('never leaks the message of an unknown error', () => {
    const safe = toSafeError(new Error('password authentication failed for user "legalintel_app"'));
    expect(safe.message).toBe('An internal error occurred.');
    expect(JSON.stringify(safe)).not.toContain('legalintel_app');
  });

  it('handles non-Error throwables', () => {
    expect(toSafeError('boom').kind).toBe('internal');
    expect(toSafeError(undefined).kind).toBe('internal');
  });

  it('is an AppError subclass with a useful name', () => {
    expect(new AppError('conflict', 'x.y', 'z').name).toBe('AppError');
  });
});
