import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  codePointLength,
  codePoints,
  FAILURES,
  failureCategory,
  IngestionFailure,
  requestSchema,
  type FailureCategory,
} from '../src';
import { requestFor, SYNTHETIC_ACT } from './support';

describe('failure taxonomy', () => {
  it('names every category the pipeline can produce, each with exactly one handling class', () => {
    const required: FailureCategory[] = [
      'rights_denied',
      'acquisition_failed',
      'integrity_failed',
      'unsupported_format',
      'extraction_failed',
      'extraction_quality_low',
      'parse_failed',
      'metadata_invalid',
      'duplicate_detected',
      'validation_failed',
      'storage_failed',
      'internal_error',
    ];
    for (const category of required) {
      expect(['terminal', 'retryable', 'review']).toContain(FAILURES[category]);
    }
  });

  it('retries only what a retry can cure', () => {
    const retryable = Object.entries(FAILURES)
      .filter(([, kind]) => kind === 'retryable')
      .map(([category]) => category)
      .sort();
    expect(retryable).toEqual(['acquisition_failed', 'storage_failed']);
    // A legal decision and a tampered file are never retried into success.
    expect(FAILURES.rights_denied).toBe('terminal');
    expect(FAILURES.integrity_failed).toBe('terminal');
  });

  it('sends what needs a person to review, not to a retry loop', () => {
    for (const category of [
      'unsupported_format',
      'extraction_quality_low',
      'parse_failed',
      'metadata_invalid',
      'duplicate_detected',
    ] as const) {
      expect(FAILURES[category]).toBe('review');
    }
  });

  it('carries a fixed message and nothing else, so no raw text can reach a user', () => {
    const failure = new IngestionFailure('parse_failed');
    expect(failure.message).toBe('Ingestion stopped: parse_failed.');
    // Only the category travels with it: no cause, no detail, no driver text.
    expect(Object.keys(failure).sort()).toEqual(['category', 'name']);
  });
});

describe('failureCategory', () => {
  it('keeps the category of a typed failure', () => {
    expect(failureCategory(new IngestionFailure('integrity_failed'))).toBe('integrity_failed');
  });

  it('reads a rights denial from the stable database hint, not from message text', () => {
    expect(failureCategory({ hint: 'corpus.rights_denied', message: 'anything' })).toBe(
      'rights_denied',
    );
    expect(failureCategory({ hint: 'ingestion.stale_rights_evidence' })).toBe('rights_denied');
    // A message that merely mentions rights is not a rights decision.
    expect(failureCategory(new Error('rights_denied: totally fine'))).toBe('internal_error');
  });

  it('treats connection, rollback, resource and shutdown faults as retryable', () => {
    for (const code of ['08006', '40001', '40P01', '53300', '57P01']) {
      expect(failureCategory({ code })).toBe('storage_failed');
      expect(FAILURES[failureCategory({ code })]).toBe('retryable');
    }
  });

  it('never retries an unclassified fault or a constraint violation', () => {
    expect(failureCategory({ code: '23505' })).toBe('internal_error');
    expect(failureCategory({ code: '23514' })).toBe('internal_error');
    expect(failureCategory(new Error('boom with secret=abc'))).toBe('internal_error');
    expect(failureCategory('a string')).toBe('internal_error');
    expect(failureCategory(null)).toBe('internal_error');
    expect(failureCategory(undefined)).toBe('internal_error');
  });

  it('classifies typed corpus errors by their stable code', () => {
    expect(failureCategory({ code: 'corpus.rights_denied' })).toBe('rights_denied');
    expect(failureCategory({ code: 'corpus.duplicate_content' })).toBe('duplicate_detected');
  });
});

describe('request schema', () => {
  const valid = () => requestFor(SYNTHETIC_ACT);

  it('accepts a bounded, well-formed request', () => {
    expect(requestSchema.safeParse(valid()).success).toBe(true);
  });

  it('refuses any key it does not define, in particular a tenant or a storage location', () => {
    for (const extra of [
      { organizationId: randomUUID() },
      { storageKey: 'corpus-x' },
      { path: '/etc/passwd' },
      { url: 'https://example.test/file' },
    ]) {
      expect(requestSchema.safeParse({ ...valid(), ...extra }).success).toBe(false);
    }
  });

  it('refuses anything but the structure operation', () => {
    expect(requestSchema.safeParse({ ...valid(), operation: 'publish' }).success).toBe(false);
    expect(requestSchema.safeParse({ ...valid(), operation: 'search' }).success).toBe(false);
  });

  it('refuses labels that could inject into logs or paths', () => {
    for (const bad of ['a b', 'a\nb', '../x', 'a/b', '', 'x'.repeat(129), '-leading']) {
      expect(requestSchema.safeParse({ ...valid(), idempotencyKey: bad }).success).toBe(false);
      expect(requestSchema.safeParse({ ...valid(), parserId: bad }).success).toBe(false);
    }
  });

  it('refuses malformed checksums, media types and identifiers', () => {
    expect(requestSchema.safeParse({ ...valid(), expectedChecksum: 'abc' }).success).toBe(false);
    expect(requestSchema.safeParse({ ...valid(), expectedChecksum: 'A'.repeat(64) }).success).toBe(
      false,
    );
    expect(requestSchema.safeParse({ ...valid(), mediaType: 'application/zip' }).success).toBe(
      false,
    );
    expect(requestSchema.safeParse({ ...valid(), sourceId: 'not-a-uuid' }).success).toBe(false);
    expect(requestSchema.safeParse({ ...valid(), documentType: 'contract' }).success).toBe(false);
  });
});

describe('offset arithmetic', () => {
  it('counts code points, the way the database indexes text', () => {
    const text = 'a' + String.fromCodePoint(0x1d518) + 'b';
    expect(text.length).toBe(4);
    expect(codePointLength(text)).toBe(3);
    expect(codePoints(text)).toHaveLength(3);
  });
});
