import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ClientId, MatterId } from '../src';

describe('workspace identifiers', () => {
  it('accepts UUID identifiers', () => {
    const client = ClientId.parse(randomUUID());
    const matter = MatterId.parse(randomUUID());

    expect(ClientId.is(client)).toBe(true);
    expect(MatterId.is(matter)).toBe(true);
  });

  it('rejects invalid identifiers', () => {
    expect(() => ClientId.parse('client-1')).toThrow();
    expect(() => MatterId.parse('matter-1')).toThrow();
  });
});
