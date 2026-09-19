import { composeCatalog, permissionsForStaff, platformPermissions } from '@legalintel/iam';
import { describe, expect, it } from 'vitest';

import { ingestionPermissions } from '../src';

const catalog = composeCatalog([platformPermissions, ingestionPermissions]);

describe('ingestion permissions', () => {
  it('compose into the platform catalogue without conflict', () => {
    for (const key of [
      'ingestion:request',
      'ingestion:inspect',
      'corpus:review',
      'corpus:publish',
    ]) {
      expect(catalog.permissions.has(key)).toBe(true);
    }
  });

  it('keep requesting, reviewing and publishing in three different staff roles', () => {
    const operator = permissionsForStaff(catalog, ['ingestion_operator']);
    const reviewer = permissionsForStaff(catalog, ['data_reviewer']);
    const publisher = permissionsForStaff(catalog, ['data_publisher']);

    expect([...operator]).toEqual(['ingestion:request']);
    expect(reviewer.has('corpus:review')).toBe(true);
    expect(reviewer.has('ingestion:inspect')).toBe(true);
    expect(publisher.has('corpus:publish')).toBe(true);

    // The role that starts ingestion cannot approve or publish what it produced.
    expect(operator.has('corpus:review')).toBe(false);
    expect(operator.has('corpus:publish')).toBe(false);
    // Reviewing and publishing are never held together by one role.
    expect(reviewer.has('corpus:publish')).toBe(false);
    expect(publisher.has('corpus:review')).toBe(false);
    expect(reviewer.has('ingestion:request')).toBe(false);
  });

  it('are not available to any organisation role or API key', () => {
    for (const grants of catalog.orgRolePermissions.values()) {
      for (const key of [
        'ingestion:request',
        'ingestion:inspect',
        'corpus:review',
        'corpus:publish',
      ]) {
        expect(grants.has(key)).toBe(false);
      }
    }
    for (const key of [
      'ingestion:request',
      'ingestion:inspect',
      'corpus:review',
      'corpus:publish',
    ]) {
      expect(catalog.apiKeyEligible.has(key)).toBe(false);
    }
  });
});
