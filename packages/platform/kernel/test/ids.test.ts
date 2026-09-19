import { describe, expect, expectTypeOf, it } from 'vitest';

import { AppError, OrganizationId, UserId, defineIdKind } from '../src';

describe('id kinds', () => {
  it('generates valid, unique, time-ordered UUIDv7 values', () => {
    const first = OrganizationId.generate();
    const second = OrganizationId.generate();

    expect(OrganizationId.is(first)).toBe(true);
    expect(first).not.toBe(second);
    // Version nibble is the first character of the third group.
    expect(first.split('-')[2]?.[0]).toBe('7');
    // UUIDv7 sorts by creation time, which is why we use it for index locality.
    expect([second, first].sort()[0]).toBe(first);
  });

  it('parses and canonicalizes valid identifiers, including non-v7 database defaults', () => {
    const v4 = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
    expect(UserId.parse(v4)).toBe(v4.toLowerCase());
  });

  it.each([
    ['empty string', ''],
    ['garbage', 'not-a-uuid'],
    ['nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['SQL fragment', "'; DROP TABLE users; --"],
  ])('rejects %s', (_label, value) => {
    expect(() => UserId.parse(value)).toThrow(AppError);
    expect(UserId.is(value)).toBe(false);
  });

  it('does not treat an uppercase UUID as an already-canonical id', () => {
    expect(UserId.is('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(false);
  });

  it('reports a stable machine-readable error code without echoing the input', () => {
    try {
      UserId.parse("'; DROP TABLE users; --");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.kind).toBe('validation');
      expect(appError.code).toBe('id.invalid');
      expect(appError.message).not.toContain('DROP TABLE');
    }
  });

  it('keeps identifier kinds nominally distinct at compile time', () => {
    const orgId = OrganizationId.generate();
    const userId = UserId.generate();

    expectTypeOf(orgId).not.toEqualTypeOf(userId);

    const takesOrg = (_id: typeof orgId) => undefined;
    // @ts-expect-error a UserId must not be accepted where an OrganizationId is required
    takesOrg(userId);
    // A plain string must not be accepted either.
    // @ts-expect-error unvalidated strings are not identifiers
    takesOrg('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    takesOrg(orgId);
  });

  it('lets other packages define their own kinds', () => {
    const DocumentId = defineIdKind('Document');
    const id = DocumentId.generate();
    expect(DocumentId.is(id)).toBe(true);
    expect(DocumentId.kind).toBe('Document');
  });
});
