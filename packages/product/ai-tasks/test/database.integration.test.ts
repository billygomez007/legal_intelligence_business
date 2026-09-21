import { randomUUID } from 'node:crypto';

import { getMigrationStatus } from '@legalintel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTaskWorld,
  insertScope,
  insertTask,
  migrationSets,
  rawTask,
  type TaskWorld,
} from './support';

let w: TaskWorld;
beforeAll(async () => {
  w = await createTaskWorld();
});
afterAll(async () => {
  await w.database.dispose();
});
const update = (id: string, sql: string, values: readonly unknown[] = []) =>
  w.run(w.orgA, (tx) => tx.query(`UPDATE ai_tasks.tasks SET ${sql} WHERE id=$1`, [id, ...values]));

describe('Phase 6A real database boundaries', () => {
  it('applies in the full migration sequence', async () => {
    const status = await w.database.withMigrator((c) => getMigrationStatus(c, migrationSets));
    expect(status.every((s) => s.state === 'applied')).toBe(true);
    expect(status.find((s) => s.set === 'ai_tasks')?.version).toBe(1);
  });

  it('installs AI task tables with tenant RLS enabled and forced', async () => {
    const result = await w.database.withAdmin((client) =>
      client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`
        SELECT
          c.relname,
          c.relrowsecurity,
          c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = 'ai_tasks'
          AND c.relname IN ('tasks', 'task_scope_revisions')
        ORDER BY c.relname
      `),
    );

    expect(result.rows).toEqual([
      {
        relname: 'task_scope_revisions',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: 'tasks',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);
  });

  it('gives the application USAGE but not CREATE on the AI task schema', async () => {
    const result = await w.database.withAdmin((client) =>
      client.query<{
        can_use: boolean;
        can_create: boolean;
      }>(`
        SELECT
          has_schema_privilege(
            'legalintel_app',
            'ai_tasks',
            'USAGE'
          ) AS can_use,
          has_schema_privilege(
            'legalintel_app',
            'ai_tasks',
            'CREATE'
          ) AS can_create
      `),
    );

    expect(result.rows).toEqual([
      {
        can_use: true,
        can_create: false,
      },
    ]);
  });
  it.each([
    ['tasks', 'SELECT', true],
    ['tasks', 'INSERT', true],
    ['tasks', 'UPDATE', true],
    ['tasks', 'DELETE', false],
    ['tasks', 'TRUNCATE', false],
    ['task_scope_revisions', 'SELECT', true],
    ['task_scope_revisions', 'INSERT', true],
    ['task_scope_revisions', 'UPDATE', false],
    ['task_scope_revisions', 'DELETE', false],
    ['task_scope_revisions', 'TRUNCATE', false],
  ])('runtime privilege %s %s = %s', async (table, privilege, allowed) => {
    const r = await w.run(w.orgA, (tx) =>
      tx.query<{ allowed: boolean }>('SELECT has_table_privilege(current_user,$1,$2) AS allowed', [
        `ai_tasks.${table}`,
        privilege,
      ]),
    );
    expect(r.rows[0]?.allowed).toBe(allowed);
  });
  it('creates task and initial scope atomically and exposes both only to their tenant', async () => {
    const id = await rawTask(w);
    for (const table of ['tasks', 'task_scope_revisions']) {
      const column = table === 'tasks' ? 'id' : 'task_id';
      expect(
        (
          await w.run(w.orgA, (tx) =>
            tx.query(`SELECT * FROM ai_tasks.${table} WHERE ${column}=$1`, [id]),
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await w.run(w.orgB, (tx) =>
            tx.query(`SELECT * FROM ai_tasks.${table} WHERE ${column}=$1`, [id]),
          )
        ).rowCount,
      ).toBe(0);
    }
    expect(
      (
        await w.run(w.orgB, (tx) =>
          tx.query("UPDATE ai_tasks.tasks SET title='tamper' WHERE id=$1", [id]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it('prevents organization spoofing', async () => {
    await expect(
      w.run(w.orgA, (tx) =>
        tx.query(
          `INSERT INTO ai_tasks.tasks
      (organization_id,id,requested_by_user_id,employee_type,title,instructions)
      VALUES ($1,$2,$3,'ai_paralegal','x','x')`,
          [w.orgB, randomUUID(), w.userA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('refuses a scope inserted from another tenant', async () => {
    const id = await rawTask(w);
    await expect(
      w.run(w.orgB, (tx) => insertScope(tx, w, id, { revision: 2 })),
    ).rejects.toMatchObject({ hint: 'ai_tasks.task_not_found' });
  });
  it('accepts a same-tenant matter', async () => {
    await expect(
      rawTask(w, { mode: 'ghana_corpus_and_matter', matterId: w.matterA.id }),
    ).resolves.toBeTypeOf('string');
  });
  it('refuses another tenant matter', async () => {
    await expect(
      rawTask(w, { mode: 'ghana_corpus_and_matter', matterId: w.matterB.id }),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('refuses an unsupported code without introducing another country fixture', async () => {
    await expect(rawTask(w, { jurisdictionCode: 'ZZ-UNSUP' })).rejects.toMatchObject({
      code: '23514',
    });
  });
  it('refuses a noncanonical id disguised with a GH code', async () => {
    await expect(rawTask(w, { jurisdictionId: w.unsupported })).rejects.toMatchObject({
      hint: 'ai_tasks.jurisdiction_invalid',
    });
  });
  it.each([
    { mode: 'ghana_corpus_and_matter' },
    { mode: 'ghana_corpus_and_matter_and_firm_knowledge' },
    { mode: 'ghana_corpus', matter: true },
    { mode: 'ghana_corpus_and_firm_knowledge', matter: true },
  ])('enforces matter shape %j', async ({ mode, ...rest }) => {
    await expect(
      rawTask(w, { mode, matterId: 'matter' in rest ? w.matterA.id : null }),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('cannot commit a task without its current revision', async () => {
    await expect(w.run(w.orgA, (tx) => insertTask(tx, w.userA))).rejects.toMatchObject({
      code: '23503',
    });
  });
  it('requires revision one before revision two', async () => {
    await expect(
      w.run(w.orgA, async (tx) => {
        const id = await insertTask(tx, w.userA);
        await insertScope(tx, w, id, { revision: 2 });
        await tx.query('UPDATE ai_tasks.tasks SET current_scope_revision=2 WHERE id=$1', [id]);
      }),
    ).rejects.toMatchObject({ hint: 'ai_tasks.invalid_scope_revision' });
  });
  it('appends sequential revisions and refuses duplicate, skipped and regressing revisions', async () => {
    const id = await rawTask(w);
    for (const revision of [1, 3, 0]) {
      await expect(
        w.run(w.orgA, (tx) => insertScope(tx, w, id, { revision })),
      ).rejects.toBeDefined();
    }
    await w.run(w.orgA, async (tx) => {
      await insertScope(tx, w, id, { revision: 2 });
      await tx.query('UPDATE ai_tasks.tasks SET current_scope_revision=2 WHERE id=$1', [id]);
    });
    await expect(update(id, 'current_scope_revision=1')).rejects.toMatchObject({
      hint: 'ai_tasks.scope_revision_regression',
    });
  });
  it('cannot skip a revision by temporarily changing the pointer', async () => {
    const id = await rawTask(w);
    await expect(
      w.run(w.orgA, async (tx) => {
        await tx.query('UPDATE ai_tasks.tasks SET current_scope_revision=2 WHERE id=$1', [id]);
        await insertScope(tx, w, id, { revision: 3 });
        await tx.query('UPDATE ai_tasks.tasks SET current_scope_revision=3 WHERE id=$1', [id]);
      }),
    ).rejects.toMatchObject({ hint: 'ai_tasks.invalid_scope_revision' });
  });
  it('cannot commit appended history without advancing the current pointer', async () => {
    const id = await rawTask(w);
    await expect(
      w.run(w.orgA, (tx) => insertScope(tx, w, id, { revision: 2 })),
    ).rejects.toMatchObject({ hint: 'ai_tasks.scope_pointer_invalid' });
  });
  it.each(['UPDATE', 'DELETE'])('runtime cannot %s scope history', async (operation) => {
    const id = await rawTask(w);
    const sql =
      operation === 'UPDATE'
        ? 'UPDATE ai_tasks.task_scope_revisions SET revision=2 WHERE task_id=$1'
        : 'DELETE FROM ai_tasks.task_scope_revisions WHERE task_id=$1';
    await expect(w.run(w.orgA, (tx) => tx.query(sql, [id]))).rejects.toMatchObject({
      code: '42501',
    });
    await expect(w.database.withAdmin((c) => c.query(sql, [id]))).rejects.toMatchObject({
      hint: 'ai_tasks.scope_revision_immutable',
    });
  });
  it('runtime cannot delete tasks', async () => {
    const id = await rawTask(w);
    await expect(
      w.run(w.orgA, (tx) => tx.query('DELETE FROM ai_tasks.tasks WHERE id=$1', [id])),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('allows draft edits and all three valid lifecycle transitions', async () => {
    const id = await rawTask(w);
    await update(id, "title='new title',instructions='new instructions'");
    await update(id, "status='ready'");
    await update(id, "status='cancelled'");
    const other = await rawTask(w);
    await update(other, "status='cancelled'");
  });
  it.each(['ready', 'cancelled'])('freezes %s definition and scope history', async (status) => {
    const id = await rawTask(w);
    await update(id, 'status=$2', [status]);
    for (const sql of [
      "title='changed'",
      "instructions='changed'",
      'current_scope_revision=2',
      "status='draft'",
    ]) {
      await expect(update(id, sql)).rejects.toBeDefined();
    }
    await expect(
      w.run(w.orgA, (tx) => insertScope(tx, w, id, { revision: 2 })),
    ).rejects.toMatchObject({ hint: 'ai_tasks.scope_frozen' });
  });
  it('freezes cancelled timestamps as well as definition', async () => {
    const id = await rawTask(w);
    await update(id, "status='cancelled'");
    await expect(update(id, "created_at='2000-01-01'::timestamptz")).rejects.toBeDefined();
    await expect(update(id, "updated_at='2000-01-01'::timestamptz")).rejects.toBeDefined();
  });
  it.each(['organization_id', 'id', 'requested_by_user_id', 'employee_type'])(
    'keeps identity %s immutable',
    async (field) => {
      const id = await rawTask(w);
      await expect(
        update(id, `${field}=$2`, [
          field === 'employee_type'
            ? 'contract_analyst'
            : field === 'organization_id'
              ? w.orgB
              : field === 'requested_by_user_id'
                ? w.userB
                : randomUUID(),
        ]),
      ).rejects.toMatchObject({ hint: 'ai_tasks.identity_immutable' });
    },
  );
});
