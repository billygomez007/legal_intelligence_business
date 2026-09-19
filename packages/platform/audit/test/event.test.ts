import { describe, expect, it } from 'vitest';

import { validateAuditEvent, type AuditEvent } from '../src';

const base: AuditEvent = {
  actorKind: 'user',
  actorId: 'u-1',
  action: 'member.removed',
  outcome: 'success',
};
const withMetadata = (metadata: Record<string, unknown>): AuditEvent => ({ ...base, metadata });
const rejects = (event: AuditEvent, pattern: RegExp) => {
  expect(() => {
    validateAuditEvent(event);
  }).toThrow(
    expect.objectContaining({
      code: 'audit.invalid_event',
      message: expect.stringMatching(pattern) as string,
    }) as Error,
  );
};

describe('validateAuditEvent', () => {
  it('accepts identifiers, counts and outcomes', () => {
    expect(() => {
      validateAuditEvent({
        ...base,
        resourceType: 'membership',
        resourceId: 'abc',
        requestId: 'req-1',
        metadata: {
          role: 'admin',
          previousRoles: ['member'],
          count: 3,
          dryRun: false,
          retrievalIds: ['r1', 'r2'],
        },
      });
    }).not.toThrow();
  });

  it.each(['Member.Removed', 'x', 'has space', 'trailing.', '.leading', 'a'.repeat(101), ''])(
    'rejects the action %j',
    (action) => {
      rejects({ ...base, action }, /Audit action/);
    },
  );

  it('rejects a malformed resource type', () => {
    rejects({ ...base, resourceType: 'Bad-Type' }, /resourceType/);
  });

  describe('keeps content out of the audit trail (docs/17: log identifiers, not content)', () => {
    it.each([
      'text',
      'content',
      'query',
      'queryText',
      'prompt',
      'passageText',
      'body',
      'password',
      'email',
      'token',
      'TEXT',
    ])('rejects a sensitive top-level key: %s', (key) => {
      rejects(withMetadata({ [key]: 'x' }), /sensitive field name/);
    });

    it('rejects sensitive keys at any depth, including inside arrays', () => {
      rejects(withMetadata({ run: { retrieval: { passageText: 'x' } } }), /sensitive field name/);
      rejects(withMetadata({ items: [{ ok: 1 }, { content: 'x' }] }), /sensitive field name/);
    });

    it('rejects a long string even under an innocent key, since that is what pasted content looks like', () => {
      rejects(withMetadata({ note: 'x'.repeat(257) }), /longer than 256/);
      expect(() => {
        validateAuditEvent(withMetadata({ note: 'x'.repeat(256) }));
      }).not.toThrow();
    });
  });

  it('rejects deeply nested metadata', () => {
    rejects(withMetadata({ a: { b: { c: { d: { e: 1 } } } } }), /nested too deeply/);
  });

  it('rejects oversized metadata', () => {
    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v'.repeat(100)]),
    );
    rejects(withMetadata(many), /too large/);
  });

  it('rejects values JSON cannot represent faithfully', () => {
    rejects(withMetadata({ fn: () => 1 }), /unsupported value type/);
  });

  it('rejects an over-long actor id', () => {
    rejects({ ...base, actorId: 'x'.repeat(129) }, /actorId/);
  });
});
