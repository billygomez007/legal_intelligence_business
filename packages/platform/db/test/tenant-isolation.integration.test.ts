import { OrganizationId, UserId } from '@legalintel/kernel';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withPublicTransaction, withTenantTransaction } from '../src';
import { createTestDatabase, type TestDatabase } from '../src/testing';

/**
 * These tests use probe tables built with the same `app.enable_tenant_rls()` helper that
 * every real tenant table uses, and connect as the real runtime role. They prove the
 * mechanism (context, policies, FK shape, pooling behaviour) independently of any product
 * table, and each hazard the design guards against is first demonstrated with a negative
 * control, so the defence is justified by evidence rather than assertion.
 */

let database: TestDatabase;
let pool: Pool;

const orgA = OrganizationId.generate();
const orgB = OrganizationId.generate();
const userA = UserId.generate();

const SETUP = `
  CREATE SCHEMA probe;

  CREATE TABLE probe.matters (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL DEFAULT gen_random_uuid(),
    slug            text NOT NULL,
    title           text NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, slug)
  );

  -- Correct: composite foreign key includes organization_id.
  CREATE TABLE probe.notes (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL DEFAULT gen_random_uuid(),
    matter_id       uuid NOT NULL,
    body            text NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (organization_id, matter_id) REFERENCES probe.matters (organization_id, id)
  );

  -- Negative control: a plain foreign key, the mistake the guardrail forbids.
  CREATE TABLE probe.notes_plain_fk (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    matter_id       uuid NOT NULL REFERENCES probe.matters (id),
    body            text NOT NULL
  );

  -- Negative control: permissive-only policy design, vulnerable to a later "USING (true)".
  CREATE TABLE probe.permissive_only (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    label           text NOT NULL
  );
  ALTER TABLE probe.permissive_only ENABLE ROW LEVEL SECURITY;
  ALTER TABLE probe.permissive_only FORCE ROW LEVEL SECURITY;
  CREATE POLICY only_own ON probe.permissive_only AS PERMISSIVE FOR ALL TO legalintel_app
    USING (organization_id = (SELECT app.current_org_id()))
    WITH CHECK (organization_id = (SELECT app.current_org_id()));

  -- Negative control: RLS enabled but NOT forced, so the owner bypasses it.
  CREATE TABLE probe.unforced (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    label           text NOT NULL
  );
  ALTER TABLE probe.unforced ENABLE ROW LEVEL SECURITY;
  CREATE POLICY only_own ON probe.unforced AS PERMISSIVE FOR ALL TO legalintel_app
    USING (organization_id = (SELECT app.current_org_id()));

  CALL app.enable_tenant_rls('probe.matters');
  CALL app.enable_tenant_rls('probe.notes');
  CALL app.enable_tenant_rls('probe.notes_plain_fk');

  CREATE VIEW probe.matters_definer_view AS SELECT * FROM probe.matters;
  CREATE VIEW probe.matters_invoker_view WITH (security_invoker = true) AS
    SELECT * FROM probe.matters;
  CREATE VIEW probe.unforced_definer_view AS SELECT * FROM probe.unforced;

  GRANT USAGE ON SCHEMA probe TO legalintel_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA probe TO legalintel_app;
`;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.withMigrator((client) => client.query(SETUP));
  pool = database.poolFor('app', { max: 8 });

  for (const [org, prefix] of [
    [orgA, 'a'],
    [orgB, 'b'],
  ] as const) {
    await withTenantTransaction(pool, { organizationId: org }, async (tx) => {
      for (const n of [1, 2]) {
        await tx.query(
          'INSERT INTO probe.matters (organization_id, slug, title) VALUES ($1, $2, $3)',
          [org, `${prefix}-${n}`, `Matter ${prefix}${n}`],
        );
      }
      await tx.query('INSERT INTO probe.permissive_only (organization_id, label) VALUES ($1, $2)', [
        org,
        `${prefix}-label`,
      ]);
    });
  }
  // Rows in the not-forced table are inserted as the (bypassing) owner.
  await database.withMigrator((client) =>
    client.query(
      `INSERT INTO probe.unforced (organization_id, label) VALUES ($1, 'a-secret'), ($2, 'b-secret')`,
      [orgA, orgB],
    ),
  );
});

afterAll(async () => {
  await database.dispose();
});

const titles = (rows: readonly { title: string }[]) => rows.map((row) => row.title).sort();

describe('tenant context and row-level security', () => {
  it('shows each tenant only its own rows', async () => {
    const a = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      tx.query<{ title: string }>('SELECT title FROM probe.matters'),
    );
    const b = await withTenantTransaction(pool, { organizationId: orgB }, (tx) =>
      tx.query<{ title: string }>('SELECT title FROM probe.matters'),
    );

    expect(titles(a.rows)).toEqual(['Matter a1', 'Matter a2']);
    expect(titles(b.rows)).toEqual(['Matter b1', 'Matter b2']);
  });

  it('applies the same isolation even when the query asks for another tenant explicitly', async () => {
    const result = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      tx.query('SELECT * FROM probe.matters WHERE organization_id = $1', [orgB]),
    );
    expect(result.rows).toHaveLength(0);
  });

  it('fails closed: no tenant context means no rows', async () => {
    const viaPublic = await withPublicTransaction(pool, (tx) =>
      tx.query('SELECT * FROM probe.matters'),
    );
    expect(viaPublic.rows).toHaveLength(0);

    // A raw query outside any helper, as a buggy handler might issue, is equally empty.
    const raw = await pool.query('SELECT * FROM probe.matters');
    expect(raw.rows).toHaveLength(0);
  });

  it('fails closed for a malformed context set behind the helper’s back', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', 'not-a-uuid', true)`);
      const result = await client.query('SELECT * FROM probe.matters');
      expect(result.rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rejects inserting a row owned by another tenant (WITH CHECK)', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query(
          `INSERT INTO probe.matters (organization_id, slug, title) VALUES ($1, 'stolen', 'x')`,
          [orgB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects moving a row to another tenant with UPDATE', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query('UPDATE probe.matters SET organization_id = $1 WHERE slug = $2', [orgB, 'a-1']),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot update or delete another tenant’s rows: they are simply not there', async () => {
    const outcome = await withTenantTransaction(pool, { organizationId: orgA }, async (tx) => {
      const update = await tx.query(
        `UPDATE probe.matters SET title = 'hijacked' WHERE slug = 'b-1'`,
      );
      const remove = await tx.query(`DELETE FROM probe.matters WHERE slug LIKE 'b-%'`);
      return { updated: update.rowCount, deleted: remove.rowCount };
    });
    expect(outcome).toEqual({ updated: 0, deleted: 0 });

    const b = await withTenantTransaction(pool, { organizationId: orgB }, (tx) =>
      tx.query<{ title: string }>('SELECT title FROM probe.matters'),
    );
    expect(titles(b.rows)).toEqual(['Matter b1', 'Matter b2']);
  });

  it('cannot TRUNCATE, which is not subject to row-level security', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query('TRUNCATE probe.matters'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('exposes the acting user to policies when provided', async () => {
    const result = await withTenantTransaction(
      pool,
      { organizationId: orgA, userId: userA },
      (tx) =>
        tx.query<{ org: string; user: string }>(
          'SELECT app.current_org_id() AS org, app.current_user_id() AS "user"',
        ),
    );
    expect(result.rows[0]).toEqual({ org: orgA, user: userA });
  });
});

describe('transaction helper behaviour', () => {
  it('does not leak tenant context to the next borrower of a pooled connection', async () => {
    const single = database.poolFor('app', { max: 1 });

    await withTenantTransaction(single, { organizationId: orgA }, (tx) => tx.query('SELECT 1'));
    // Same physical connection (pool of one), no helper this time.
    const after = await single.query<{ setting: string | null }>(
      `SELECT current_setting('app.org_id', true) AS setting`,
    );
    expect(after.rows[0]?.setting === null || after.rows[0]?.setting === '').toBe(true);

    const rows = await single.query('SELECT * FROM probe.matters');
    expect(rows.rows).toHaveLength(0);
  });

  it('does not leak context after a failed transaction either', async () => {
    const single = database.poolFor('app', { max: 1 });
    await expect(
      withTenantTransaction(single, { organizationId: orgA }, () => {
        throw new Error('handler blew up');
      }),
    ).rejects.toThrow('handler blew up');

    const rows = await single.query('SELECT * FROM probe.matters');
    expect(rows.rows).toHaveLength(0);
  });

  it('keeps concurrent transactions for different tenants isolated', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const org = index % 2 === 0 ? orgA : orgB;
        return withTenantTransaction(pool, { organizationId: org }, async (tx) => {
          await tx.query('SELECT pg_sleep(0.01)');
          const rows = await tx.query<{ organization_id: string }>(
            'SELECT organization_id FROM probe.matters',
          );
          return { org, seen: new Set(rows.rows.map((row) => row.organization_id)) };
        });
      }),
    );

    for (const { org, seen } of results) {
      expect([...seen]).toEqual([org]);
    }
  });

  it('rolls back everything when the handler throws', async () => {
    await expect(
      withTenantTransaction(pool, { organizationId: orgA }, async (tx) => {
        await tx.query(
          `INSERT INTO probe.matters (organization_id, slug, title) VALUES ($1, 'temp', 'temp')`,
          [orgA],
        );
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    const rows = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
      tx.query(`SELECT 1 FROM probe.matters WHERE slug = 'temp'`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('rejects an invalid organization id before touching the database', async () => {
    let ran = false;
    await expect(
      withTenantTransaction(
        pool,
        { organizationId: "'; DROP SCHEMA probe; --" as unknown as OrganizationId },
        () => {
          ran = true;
          return Promise.resolve();
        },
      ),
    ).rejects.toMatchObject({ code: 'id.invalid' });
    expect(ran).toBe(false);
  });

  it('makes a transaction handle unusable once its transaction has ended', async () => {
    let leaked: { query: (sql: string) => Promise<unknown> } | undefined;
    await withTenantTransaction(pool, { organizationId: orgA }, (tx) => {
      leaked = tx;
      return Promise.resolve();
    });
    await expect(leaked?.query('SELECT 1')).rejects.toMatchObject({ code: 'db.tx_closed' });
  });

  it('supports read-only transactions', async () => {
    await expect(
      withTenantTransaction(
        pool,
        { organizationId: orgA },
        (tx) =>
          tx.query(
            `INSERT INTO probe.matters (organization_id, slug, title) VALUES ($1, 'ro', 'ro')`,
            [orgA],
          ),
        { readOnly: true },
      ),
    ).rejects.toMatchObject({ code: '25006' });
  });
});

describe('why the design is shaped this way (negative controls)', () => {
  describe('restrictive tenant policy', () => {
    it('cannot be widened by a later permissive policy', async () => {
      await database.withAdmin((client) =>
        client.query(
          `CREATE POLICY careless ON probe.matters AS PERMISSIVE FOR ALL TO legalintel_app
             USING (true) WITH CHECK (true)`,
        ),
      );
      try {
        const a = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
          tx.query<{ title: string }>('SELECT title FROM probe.matters'),
        );
        expect(titles(a.rows)).toEqual(['Matter a1', 'Matter a2']);
      } finally {
        await database.withAdmin((client) => client.query('DROP POLICY careless ON probe.matters'));
      }
    });

    it('CONTROL: a permissive-only design IS widened by the same careless policy', async () => {
      await database.withAdmin((client) =>
        client.query(
          `CREATE POLICY careless ON probe.permissive_only AS PERMISSIVE FOR ALL TO legalintel_app
             USING (true)`,
        ),
      );
      try {
        const a = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
          tx.query<{ label: string }>('SELECT label FROM probe.permissive_only'),
        );
        expect(a.rows.map((row) => row.label).sort()).toEqual(['a-label', 'b-label']);
      } finally {
        await database.withAdmin((client) =>
          client.query('DROP POLICY careless ON probe.permissive_only'),
        );
      }
    });
  });

  describe('composite foreign keys', () => {
    let matterOfA = '';

    beforeAll(async () => {
      const result = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query<{ id: string }>(`SELECT id FROM probe.matters WHERE slug = 'a-1'`),
      );
      matterOfA = result.rows[0]?.id ?? '';
      expect(matterOfA).not.toBe('');
    });

    it('make a cross-tenant reference structurally impossible', async () => {
      await expect(
        withTenantTransaction(pool, { organizationId: orgB }, (tx) =>
          tx.query(
            'INSERT INTO probe.notes (organization_id, matter_id, body) VALUES ($1, $2, $3)',
            [orgB, matterOfA, 'B writing onto A’s matter'],
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('still allow a same-tenant reference', async () => {
      const result = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query('INSERT INTO probe.notes (organization_id, matter_id, body) VALUES ($1, $2, $3)', [
          orgA,
          matterOfA,
          'A on A',
        ]),
      );
      expect(result.rowCount).toBe(1);
    });

    it('CONTROL: a plain foreign key lets tenant B attach a row to tenant A’s matter', async () => {
      // Referential-integrity checks bypass row-level security. B never sees A's matter, yet
      // the database accepts the reference, and a wrong id would raise a different error
      // than a right one: an existence oracle across tenants.
      const result = await withTenantTransaction(pool, { organizationId: orgB }, (tx) =>
        tx.query(
          'INSERT INTO probe.notes_plain_fk (organization_id, matter_id, body) VALUES ($1, $2, $3)',
          [orgB, matterOfA, 'cross-tenant reference that should be impossible'],
        ),
      );
      expect(result.rowCount).toBe(1);
    });
  });

  describe('uniqueness', () => {
    it('is per tenant, so identical keys in different tenants neither collide nor reveal each other', async () => {
      for (const org of [orgA, orgB]) {
        const result = await withTenantTransaction(pool, { organizationId: org }, (tx) =>
          tx.query(
            `INSERT INTO probe.matters (organization_id, slug, title) VALUES ($1, 'shared-slug', 'x')`,
            [org],
          ),
        );
        expect(result.rowCount).toBe(1);
      }
    });

    it('still rejects a duplicate within one tenant', async () => {
      await expect(
        withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
          tx.query(
            `INSERT INTO probe.matters (organization_id, slug, title) VALUES ($1, 'shared-slug', 'dup')`,
            [orgA],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('views', () => {
    it('security_invoker views respect the caller’s tenant', async () => {
      const a = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query<{ organization_id: string }>(
          'SELECT organization_id FROM probe.matters_invoker_view',
        ),
      );
      expect(new Set(a.rows.map((row) => row.organization_id))).toEqual(new Set([orgA]));
    });

    it('a definer view over a FORCEd table returns nothing rather than leaking', async () => {
      const a = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query('SELECT * FROM probe.matters_definer_view'),
      );
      expect(a.rows).toHaveLength(0);
    });

    it('CONTROL: a definer view over a table that is not FORCEd leaks every tenant', async () => {
      const a = await withTenantTransaction(pool, { organizationId: orgA }, (tx) =>
        tx.query<{ label: string }>('SELECT label FROM probe.unforced_definer_view'),
      );
      expect(a.rows.map((row) => row.label).sort()).toEqual(['a-secret', 'b-secret']);
    });
  });
});
