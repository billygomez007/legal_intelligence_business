import { NIL, v7 as uuidv7, validate } from 'uuid';

import type { Brand } from './brand';
import { validationError } from './errors';

export type Id<K extends string> = Brand<string, `${K}Id`>;

export interface IdKind<K extends string> {
  readonly kind: K;
  /** New time-ordered UUIDv7, which keeps B-tree index inserts local. */
  generate(): Id<K>;
  /** Validates and canonicalizes (lowercase). Throws a `validation` AppError. */
  parse(value: unknown): Id<K>;
  is(value: unknown): value is Id<K>;
}

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Accepts any valid UUID, not only v7: rows created by database defaults are v4.
 * Rejects the nil UUID, which is almost always an uninitialised value rather than an entity.
 */
function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && validate(value) && value.toLowerCase() !== NIL;
}

export function defineIdKind<K extends string>(kind: K): IdKind<K> {
  return {
    kind,
    generate: () => uuidv7() as Id<K>,
    parse(value) {
      if (!isValidUuid(value)) {
        throw validationError('id.invalid', `Invalid ${kind} identifier.`, { details: { kind } });
      }
      const canonical = value.toLowerCase();
      if (!CANONICAL.test(canonical)) {
        throw validationError('id.invalid', `Invalid ${kind} identifier.`, { details: { kind } });
      }
      return canonical as Id<K>;
    },
    is: (value): value is Id<K> =>
      isValidUuid(value) && value === value.toLowerCase() && CANONICAL.test(value),
  };
}

/**
 * Platform-level identifiers. These live in the kernel because tenancy is enforced across
 * packages: the database layer needs `OrganizationId` to open a tenant transaction and must
 * not depend on the IAM package to get it.
 */
export type OrganizationId = Id<'Organization'>;
export const OrganizationId = defineIdKind('Organization');

export type UserId = Id<'User'>;
export const UserId = defineIdKind('User');

export type ApiKeyId = Id<'ApiKey'>;
export const ApiKeyId = defineIdKind('ApiKey');
