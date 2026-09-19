/**
 * Time is injected, never read from `Date.now()` in domain code. Rights expiry, version
 * effective dates and audit ordering all depend on time, and tests must control it.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface FixedClock extends Clock {
  advance(milliseconds: number): void;
  set(instant: Date): void;
}

export function createFixedClock(start: Date | string = '2026-01-01T00:00:00.000Z'): FixedClock {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
    set(instant) {
      current = new Date(instant);
    },
  };
}
