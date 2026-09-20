import { describe, expect, it } from 'vitest';

import { getMatterWorkspace, matterWorkspaceRecords } from '../src/data/matter-workspace';

describe('matter workspace demonstration data', () => {
  it('provides one clearly synthetic matter workspace', () => {
    expect(matterWorkspaceRecords.length).toBeGreaterThan(0);

    for (const matter of matterWorkspaceRecords) {
      expect(matter.reference).toMatch(/^DEMO-/);
      expect(matter.client).toMatch(/^Sample /);
    }
  });

  it('contains every required matter workspace area', () => {
    const matter = getMatterWorkspace('sample-contract-dispute');

    expect(matter).toBeDefined();
    expect(matter?.research.length).toBeGreaterThan(0);
    expect(matter?.documents.length).toBeGreaterThan(0);
    expect(matter?.tasks.length).toBeGreaterThan(0);
    expect(matter?.appointments.length).toBeGreaterThan(0);
    expect(matter?.deadlines.length).toBeGreaterThan(0);
    expect(matter?.notes.length).toBeGreaterThan(0);
    expect(matter?.activity.length).toBeGreaterThan(0);
    expect(matter?.billing.length).toBeGreaterThan(0);
  });

  it('keeps matter client billing demonstrative and separate from LexGhana subscription billing', () => {
    const matter = getMatterWorkspace('sample-contract-dispute');

    expect(matter).toBeDefined();

    for (const entry of matter?.billing ?? []) {
      expect(entry.status).toBe('Demonstration');
      expect(entry.rate).toBe(0);
      expect(entry.amount).toBe(0);
    }
  });

  it('does not calculate real legal deadlines', () => {
    const matter = getMatterWorkspace('sample-contract-dispute');

    expect(matter).toBeDefined();

    for (const deadline of matter?.deadlines ?? []) {
      expect(deadline.id).toMatch(/^DEMO-/);
    }
  });

  it('returns undefined for unknown matters', () => {
    expect(getMatterWorkspace('not-a-real-matter')).toBeUndefined();
  });
});
