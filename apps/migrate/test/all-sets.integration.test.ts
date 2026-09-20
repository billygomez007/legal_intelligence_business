import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { getMigrationStatus } from '@legalintel/db';
import {
  checkGuardrails,
  createTestDatabase,
  formatViolations,
  type TestDatabase,
} from '@legalintel/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allMigrationSets } from '../src/sets';
import { queryPrivileges, renderPrivilegeDocument } from './privileges';

/**
 * The whole schema, every package's migrations applied together in dependency order. Individual
 * packages test their own sets in isolation; this proves they compose, and holds the combined
 * schema to the structural guardrails and to a reviewed privilege document.
 */
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ migrationSets: allMigrationSets });
});

afterAll(async () => {
  await database.dispose();
});

describe('all migration sets together', () => {
  it('apply cleanly and are all recorded as applied', async () => {
    const status = await database.withMigrator((client) =>
      getMigrationStatus(client, allMigrationSets),
    );
    expect(status.length).toBeGreaterThanOrEqual(3);
    expect(status.filter((row) => row.state !== 'applied')).toEqual([]);
    expect([...new Set(status.map((row) => row.set))]).toEqual(
      allMigrationSets.map((set) => set.name),
    );
  });

  it('pass every structural guardrail on the combined schema', async () => {
    const found = await database.withAdmin((client) =>
      checkGuardrails(client, {
        // iam.memberships lets a user list their own memberships across organizations; its
        // bespoke restrictive policies are covered by the iam isolation tests.
        tenantTableExemptions: ['iam.memberships'],
        // The complete, reviewed inventory of SECURITY DEFINER functions (see
        // docs/reviews/stage-5-existing-implementation-review.md). Each runs with its owner's
        // privileges, so adding one is a decision to make on purpose, in this list.
        securityDefiners: [
          'corpus.enforce_version_lifecycle',
          'corpus.rights_decision_in_force',
          'corpus.source_allows',
          'iam.create_organization',
          'iam.provision_user',
          'iam.resolve_identity',
          // Ingestion's sole writer of corpus provenance attestations (ingestion 0002).
          'ingestion.attest_provenance',
        ],
      }),
    );
    expect(found, formatViolations(found)).toEqual([]);
  });

  it('have an up-to-date database privileges document', async () => {
    const rendered = renderPrivilegeDocument(await database.withAdmin(queryPrivileges));
    const target = new URL('../../../docs/architecture/database-privileges.md', import.meta.url);

    if (process.env['UPDATE_DOCS'] === '1') writeFileSync(target, rendered);

    expect(existsSync(target), 'run `UPDATE_DOCS=1 pnpm test:integration` to generate it').toBe(
      true,
    );
    expect(
      readFileSync(target, 'utf8'),
      'database privileges changed; review the diff and regenerate with UPDATE_DOCS=1 pnpm test:integration',
    ).toBe(rendered);
  });

  it('never grants a runtime role a dangerous privilege in the rendered document', async () => {
    const rendered = renderPrivilegeDocument(await database.withAdmin(queryPrivileges));
    expect(rendered).not.toMatch(/TRUNCATE|TRIGGER|REFERENCES/);
  });
});
