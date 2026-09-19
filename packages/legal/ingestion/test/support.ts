import { createHash, randomUUID } from 'node:crypto';

import { requestSchema, type IngestionRequest } from '../src';

export const sha256Hex = (input: string | Uint8Array): string =>
  createHash('sha256').update(input).digest('hex');

/** A well-formed request over the given content. Every id is random and fictional. */
export function requestFor(
  content: string | Uint8Array,
  overrides: Partial<IngestionRequest> = {},
) {
  return requestSchema.parse({
    sourceId: randomUUID(),
    jurisdictionId: randomUUID(),
    operation: 'structure',
    inputReference: randomUUID(),
    expectedChecksum: sha256Hex(content),
    mediaType: 'text/plain',
    parserId: 'labelled-v1',
    documentType: 'legislation',
    idempotencyKey: `key-${randomUUID()}`,
    actorId: randomUUID(),
    correlationId: randomUUID(),
    ...overrides,
  });
}

/** Characters built from code points, so this file contains no invisible or control literals. */
export const chr = (...points: number[]): string => String.fromCodePoint(...points);

export const SYNTHETIC_ACT = [
  'Title: SYNTHETIC Test Act 1 (NOT REAL LAW)',
  'Identifier: SYN/ACT/1',
  'Jurisdiction: SYNTHETIC',
  '',
  'PART 1',
  '1. A fictional widget must be registered with the fictional registrar.',
  '2. A fictional registration lasts for one fictional year.',
].join('\n');
