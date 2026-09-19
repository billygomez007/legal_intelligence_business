import { describe, expect, it } from 'vitest';

import {
  AppError,
  assertNever,
  createFixedClock,
  err,
  invariant,
  mapResult,
  ok,
  systemClock,
  unwrap,
} from '../src';

describe('Result', () => {
  it('maps success values and leaves failures untouched', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    const failure = err('nope');
    expect(mapResult(failure, (n: number) => n * 3)).toBe(failure);
  });

  it('unwrap returns values and throws errors', () => {
    expect(unwrap(ok('fine'))).toBe('fine');
    const failure = new Error('bad');
    expect(() => unwrap(err(failure))).toThrow(failure);
  });

  it('unwrap wraps non-Error failures', () => {
    expect(() => unwrap(err('plain string'))).toThrow('plain string');
  });
});

describe('Clock', () => {
  it('fixed clock is stable until advanced', () => {
    const clock = createFixedClock('2026-03-01T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z');
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-03-01T10:01:00.000Z');
  });

  it('does not let callers mutate the clock through a returned Date', () => {
    const clock = createFixedClock('2026-03-01T10:00:00.000Z');
    clock.now().setFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });

  it('system clock reports real time', () => {
    const before = Date.now();
    const observed = systemClock.now().getTime();
    expect(observed).toBeGreaterThanOrEqual(before);
  });
});

describe('assertions', () => {
  it('invariant passes silently and throws an internal AppError on violation', () => {
    expect(() => {
      invariant(true, 'fine');
    }).not.toThrow();
    try {
      invariant(false, 'tenant context present');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).kind).toBe('internal');
      expect((error as AppError).message).toContain('tenant context present');
    }
  });

  it('assertNever throws if the type system is bypassed', () => {
    expect(() => assertNever('surprise' as never, 'Unhandled state')).toThrow(/Unhandled state/);
  });
});
