import {
  withPublicTransaction,
  withTenantTransaction,
  platformMigrations,
  type DbPool,
} from '@legalintel/db';
import {
  checkGuardrails,
  createTestDatabase,
  formatViolations,
  type TestDatabase,
} from '@legalintel/db/testing';
import { OrganizationId, UserId } from '@legalintel/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditMigrations, recordAuditEvent, recordPlatformAuditEvent } from '../src';

let database: TestDatabase;
let pool: DbPool;
const orgA = OrganizationId.generate();
const orgB = OrganizationId.generate();
const user = UserId.generate();

beforeAll(async () => {
  database = await createTestDatabase({ migrationSets: [platformMigrations, auditMigrations] });
  pool = database.poolFor('app');
});

afterAll(async () => {
  await database.dispose();
});

const record = (org: OrganizationId, action: string, metadata: Record<string, unknown> = {}) =>
  withTenantTransaction(pool, { organizationId: org, userId: user }, (tx) =>
    recordAuditEvent(tx, {
      actorKind: 'user',
      actorId: user,
      action,
      outcome: 'success',
      metadata,
    }),
  );

describe('tenant audit events', () => {
  it('records an event and shows it only to its own organization', async () => {
    await record(orgA, 'member.removed', { role: 'admin' });
    await record(orgB, 'api_key.issued');

    const seenByA = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      tx.query<{ organization_id: string; action: string }>(
        'SELECT organization_id, action FROM audit.events',
      ),
    );
    expect(seenByA.rows).toEqual([{ organization_id: orgA, action: 'member.removed' }]);
  });

  it('commits with the action it describes, and rolls back with it', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, async (tx) => {
        await recordAuditEvent(tx, { actorKind: 'user', action: 'thing.done', outcome: 'success' });
        throw new Error('the action failed');
      }),
    ).rejects.toThrow('the action failed');

    const found = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      tx.query(`SELECT 1 FROM audit.events WHERE action = 'thing.done'`),
    );
    expect(found.rows).toHaveLength(0);
  });

  it('cannot write an event for another organization or with no organization', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query(
          `INSERT INTO audit.events (organization_id, actor_kind, action, outcome) VALUES ($1, 'user', 'x.y', 'success')`,
          [orgB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withPublicTransaction(pool, (tx) =>
        recordAuditEvent(tx, { actorKind: 'system', action: 'x.y', outcome: 'success' }),
      ),
    ).rejects.toBeDefined();
  });

  it('refuses content even if application validation were bypassed, by bounding size in the database', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query(
          `INSERT INTO audit.events (organization_id, actor_kind, action, outcome, metadata)
           VALUES (app.current_org_id(), 'user', 'x.y', 'success', $1::jsonb)`,
          [JSON.stringify({ blob: 'x'.repeat(6000) })],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('append-only', () => {
  it.each([
    ['UPDATE', `UPDATE audit.events SET outcome = 'error'`],
    ['DELETE', 'DELETE FROM audit.events'],
    ['TRUNCATE', 'TRUNCATE audit.events'],
  ])('rejects %s from the application role (no privilege)', async (_verb, sql) => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) => tx.query(sql)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    ['UPDATE', `UPDATE audit.events SET outcome = 'error'`],
    ['DELETE', 'DELETE FROM audit.events'],
    ['TRUNCATE', 'TRUNCATE audit.events'],
  ])('rejects %s even from a superuser (trigger, not just privilege)', async (_verb, sql) => {
    await expect(database.withAdmin((client) => client.query(sql))).rejects.toMatchObject({
      hint: 'audit.append_only',
    });
  });

  it('protects the platform log the same way', async () => {
    await withPublicTransaction(pool, (tx) =>
      recordPlatformAuditEvent(tx, {
        actorKind: 'system',
        action: 'corpus.published',
        outcome: 'success',
        resourceType: 'document_version',
        resourceId: 'v1',
      }),
    );
    await expect(
      database.withAdmin((client) => client.query('DELETE FROM audit.platform_events')),
    ).rejects.toMatchObject({ hint: 'audit.append_only' });
  });
});

describe('platform audit events', () => {
  it('can be written by every runtime role but read only by data-ops', async () => {
    for (const role of ['app', 'ingest', 'dataops'] as const) {
      await withPublicTransaction(database.poolFor(role), (tx) =>
        recordPlatformAuditEvent(tx, {
          actorKind: 'system',
          action: `${role}.acted`,
          outcome: 'success',
        }),
      );
    }
    const read = await database
      .poolFor('dataops')
      .query<{ action: string }>('SELECT action FROM audit.platform_events');
    expect(read.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['app.acted', 'ingest.acted', 'dataops.acted']),
    );

    await expect(
      database.poolFor('app').query('SELECT * FROM audit.platform_events'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      database.poolFor('ingest').query('SELECT * FROM audit.platform_events'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps ingestion and data-ops out of tenant audit events', async () => {
    for (const role of ['ingest', 'dataops'] as const) {
      await expect(
        database.poolFor(role).query('SELECT * FROM audit.events'),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('schema guardrails', () => {
  it('passes on the audit schema', async () => {
    const found = await database.withAdmin((client) => checkGuardrails(client));
    expect(found, formatViolations(found)).toEqual([]);
  });
});
