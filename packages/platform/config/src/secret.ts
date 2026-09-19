import { inspect } from 'node:util';

const REDACTED = '[REDACTED]';

/**
 * Wraps a credential so that logging, string interpolation, `JSON.stringify` and
 * `util.inspect` all print `[REDACTED]`. The only way to read the value is the explicit,
 * greppable `reveal()` call.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `Secret(${REDACTED})`;
  }
}
