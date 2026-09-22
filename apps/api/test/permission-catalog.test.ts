import { describe, expect, it } from 'vitest';

import { createLawAfriquePermissionCatalog } from '../src/runtime/permission-catalog.js';

describe('Law Afrique API permission catalog', () => {
  it('contains every permission needed by grounded legal research', () => {
    const catalog = createLawAfriquePermissionCatalog();

    for (const permission of [
      'ai_task:read',
      'matter:read',
      'knowledge:source:read',
      'knowledge:version:read',
      'matter-document:read',
      'matter-document:version:read',
      'work_product:read',
    ]) {
      expect(catalog.permissions.has(permission), permission).toBe(true);
    }
  });

  it('does not make AI task or Work Product approval authority API-key eligible', () => {
    const catalog = createLawAfriquePermissionCatalog();

    expect(catalog.apiKeyEligible.has('ai_task:read')).toBe(false);

    expect(catalog.apiKeyEligible.has('work_product:approve')).toBe(false);

    expect(catalog.apiKeyEligible.has('work_product:reject')).toBe(false);
  });
});
