import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checksumOf, loadMigrationSet, parseMigration, parseMigrationFilename } from '../src';

describe('parseMigrationFilename', () => {
  it('accepts NNNN_snake_case.sql', () => {
    expect(parseMigrationFilename('0001_foundation.sql')).toEqual({
      version: 1,
      name: 'foundation',
    });
    expect(parseMigrationFilename('0042_add_org_slug_index.sql')).toEqual({
      version: 42,
      name: 'add_org_slug_index',
    });
  });

  it.each([
    '1_short_version.sql',
    '00001_five_digits.sql',
    '0001-dashes.sql',
    '0001_Upper.sql',
    '0001_trailing_.sql',
    '0001_.sql',
    '0001_name.SQL',
    '0001_name.sql.bak',
    'foundation.sql',
  ])('rejects %s', (filename) => {
    expect(() => parseMigrationFilename(filename)).toThrow(/must be named/);
  });
});

describe('checksums', () => {
  it('do not change with line endings, so a Windows checkout is not an edited migration', () => {
    expect(checksumOf('CREATE TABLE a ();\r\nCREATE TABLE b ();\r\n')).toBe(
      checksumOf('CREATE TABLE a ();\nCREATE TABLE b ();\n'),
    );
  });

  it('change with any other edit', () => {
    expect(checksumOf('SELECT 1;')).not.toBe(checksumOf('SELECT 2;'));
    expect(checksumOf('SELECT 1;')).not.toBe(checksumOf('SELECT 1; '));
  });
});

describe('parseMigration', () => {
  it('is transactional by default', () => {
    expect(parseMigration('s', '0001_a.sql', 'CREATE TABLE a ();').transactional).toBe(true);
  });

  it('honours the no-transaction directive only on the first line', () => {
    expect(
      parseMigration(
        's',
        '0001_a.sql',
        '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY i ON t (c);',
      ).transactional,
    ).toBe(false);
    expect(
      parseMigration('s', '0001_a.sql', 'SELECT 1;\n-- migrate:no-transaction\nSELECT 2;')
        .transactional,
    ).toBe(true);
  });

  it('rejects an empty migration', () => {
    expect(() => parseMigration('s', '0001_a.sql', '  \n')).toThrow(/empty/);
  });

  describe('destructive statements (doc 14: corrections must not destroy audit history)', () => {
    it.each([
      ['DROP TABLE', 'DROP TABLE legal.documents;'],
      ['DROP SCHEMA', 'drop schema corpus cascade;'],
      ['DROP COLUMN', 'ALTER TABLE t DROP COLUMN c;'],
      ['TRUNCATE', 'TRUNCATE audit.events;'],
      ['DELETE without WHERE', 'DELETE FROM iam.users;'],
    ])('rejects %s without an explicit allowance', (_label, sql) => {
      expect(() => parseMigration('s', '0002_x.sql', sql)).toThrow(/destructive/);
    });

    it('accepts the same statement with a reasoned allowance', () => {
      const sql =
        '-- migrate:allow-destructive: table replaced by corpus.document_versions\nDROP TABLE old_docs;';
      expect(parseMigration('s', '0002_x.sql', sql).sql).toContain('DROP TABLE');
    });

    it('rejects an allowance with no reason', () => {
      expect(() =>
        parseMigration('s', '0002_x.sql', '-- migrate:allow-destructive:\nDROP TABLE t;'),
      ).toThrow(/destructive/);
    });

    it('does not mistake a protective BEFORE TRUNCATE trigger for a truncate', () => {
      expect(() =>
        parseMigration(
          's',
          '0002_x.sql',
          'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit.events FOR EACH STATEMENT EXECUTE FUNCTION f();',
        ),
      ).not.toThrow();
    });

    it('still catches a destructive statement that is not the first in the file', () => {
      expect(() =>
        parseMigration('s', '0002_x.sql', 'CREATE TABLE a (id int);\nTRUNCATE a;'),
      ).toThrow(/destructive/);
      expect(() =>
        parseMigration('s', '0002_x.sql', 'CREATE TABLE a (id int);\n  DROP TABLE b;'),
      ).toThrow(/destructive/);
    });

    it('does not flag destructive words that appear only in comments', () => {
      expect(() =>
        parseMigration('s', '0002_x.sql', '-- we never DROP TABLE here\nCREATE TABLE t ();'),
      ).not.toThrow();
    });

    it('does not flag a DELETE that has a WHERE clause', () => {
      expect(() =>
        parseMigration('s', '0002_x.sql', "DELETE FROM t WHERE kind = 'temp';"),
      ).not.toThrow();
    });
  });
});

describe('loadMigrationSet', () => {
  const directories: string[] = [];

  async function setWith(files: Record<string, string>) {
    const directory = await mkdtemp(path.join(tmpdir(), 'lip-migrations-'));
    directories.push(directory);
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(directory, name), content);
    }
    return { name: 'test', directory };
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('returns migrations ordered by version regardless of directory order', async () => {
    const set = await setWith({
      '0003_c.sql': 'SELECT 3;',
      '0001_a.sql': 'SELECT 1;',
      '0002_b.sql': 'SELECT 2;',
    });
    expect((await loadMigrationSet(set)).map((m) => m.version)).toEqual([1, 2, 3]);
  });

  it('rejects two files with the same version', async () => {
    const set = await setWith({ '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 2;' });
    await expect(loadMigrationSet(set)).rejects.toThrow(/two files with version 1/);
  });

  it('rejects a stray file instead of silently skipping it', async () => {
    const set = await setWith({ '0001_a.sql': 'SELECT 1;', 'notes.txt': 'hi' });
    await expect(loadMigrationSet(set)).rejects.toThrow(/must be named/);
  });

  it('ignores README and dotfiles', async () => {
    const set = await setWith({ '0001_a.sql': 'SELECT 1;', 'README.md': '# docs', '.keep': '' });
    expect(await loadMigrationSet(set)).toHaveLength(1);
  });
});
