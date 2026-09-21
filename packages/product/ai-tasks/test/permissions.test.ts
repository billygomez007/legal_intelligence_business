import { describe, expect, it } from 'vitest';

import { composeCatalog } from '@legalintel/iam';

import { aiTaskPermissionContribution, aiTaskPermissionKeys } from '../src/index.js';

describe('AI Tasks Phase 6A permissions', () => {
  const full = ['ai_task:create', 'ai_task:read', 'ai_task:update', 'ai_task:transition'];

  it('defines the exact task permission surface', () => {
    expect(aiTaskPermissionKeys).toEqual(full);

    expect(aiTaskPermissionContribution.permissions.map((permission) => permission.key)).toEqual(
      full,
    );
  });

  it('gives owner, admin and member full task lifecycle grants', () => {
    expect(aiTaskPermissionContribution.orgRoleGrants.owner).toEqual(full);
    expect(aiTaskPermissionContribution.orgRoleGrants.admin).toEqual(full);
    expect(aiTaskPermissionContribution.orgRoleGrants.member).toEqual(full);
  });

  it('keeps viewers read-only and gives platform staff nothing', () => {
    expect(aiTaskPermissionContribution.orgRoleGrants.viewer).toEqual(['ai_task:read']);
    expect(aiTaskPermissionContribution.staffRoleGrants).toEqual({});
  });

  it('does not make AI task permissions API-key eligible by default', () => {
    const catalog = composeCatalog([aiTaskPermissionContribution]);

    for (const permission of aiTaskPermissionKeys) {
      expect(catalog.apiKeyEligible.has(permission)).toBe(false);
    }

    expect([...catalog.apiKeyEligible]).toEqual([]);
  });
});
