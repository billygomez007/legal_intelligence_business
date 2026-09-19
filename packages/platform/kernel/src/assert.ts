import { internalError } from './errors';

/** Compile-time exhaustiveness check; also fails loudly at runtime if the types are bypassed. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw internalError('assert.never', `${message}: ${JSON.stringify(value)}`);
}

/** A programmer-error check. Not for validating user input. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw internalError('assert.invariant', `Invariant violated: ${message}`);
  }
}
