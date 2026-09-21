import { describe, expect, it } from 'vitest';

import {
  KnowledgeSourceId,
  KnowledgeSourceVersionId,
  knowledgeSourceStatuses,
} from '../src/index.js';

describe('Firm Knowledge domain', () => {
  it('defines the supported source lifecycle without destructive deletion', () => {
    expect(knowledgeSourceStatuses).toEqual(['active', 'archived']);
  });

  it('defines branded source identifiers', () => {
    expect(KnowledgeSourceId).toBeDefined();
    expect(KnowledgeSourceVersionId).toBeDefined();
  });
});
