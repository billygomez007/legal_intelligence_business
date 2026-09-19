import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { validationError } from '@legalintel/kernel';

/** A directory of ordered SQL migrations owned by one package. */
export interface MigrationSet {
  readonly name: string;
  readonly directory: string;
}

export interface MigrationFile {
  readonly set: string;
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
  /** False only for statements PostgreSQL forbids inside a transaction (CREATE INDEX CONCURRENTLY). */
  readonly transactional: boolean;
}

const FILENAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const NO_TRANSACTION_DIRECTIVE = /^\s*--\s*migrate:no-transaction\s*$/;
// Same-line whitespace only ([ \t], never \s): the reason must be on the directive's own line,
// or an empty directive would "borrow" the next line as its reason.
const DESTRUCTIVE_ALLOWANCE = /^[ \t]*--[ \t]*migrate:allow-destructive:[ \t]*\S.*$/m;

/**
 * Statements that destroy data or structure. Doc 14 requires that "corrections should not
 * destroy audit history", so a migration containing one must carry an explicit, reasoned
 * `-- migrate:allow-destructive: <why>` line that a reviewer will see in the diff.
 */
const DESTRUCTIVE_STATEMENT =
  /\b(DROP\s+(TABLE|SCHEMA|COLUMN|DATABASE)|TRUNCATE|DELETE\s+FROM\s+\S+\s*(;|$))/i;

/** Line endings must not change a checksum: a Windows checkout is not an edited migration. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, '\n');
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(normalizeSql(sql), 'utf8').digest('hex');
}

export function parseMigrationFilename(filename: string): { version: number; name: string } {
  const match = FILENAME.exec(filename);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw validationError(
      'migration.bad_filename',
      `Migration file "${filename}" must be named NNNN_snake_case_name.sql (four-digit version).`,
    );
  }
  return { version: Number.parseInt(match[1], 10), name: match[2] };
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

export function parseMigration(set: string, filename: string, rawSql: string): MigrationFile {
  const { version, name } = parseMigrationFilename(filename);
  const sql = normalizeSql(rawSql);

  const firstLine = sql.split('\n', 1)[0] ?? '';
  const transactional = !NO_TRANSACTION_DIRECTIVE.test(firstLine);

  if (sql.trim() === '') {
    throw validationError('migration.empty', `Migration ${set}/${filename} is empty.`);
  }
  if (DESTRUCTIVE_STATEMENT.test(stripComments(sql)) && !DESTRUCTIVE_ALLOWANCE.test(sql)) {
    throw validationError(
      'migration.destructive_unannotated',
      `Migration ${set}/${filename} contains a destructive statement (DROP TABLE/SCHEMA/COLUMN, TRUNCATE, unqualified DELETE). ` +
        'Add "-- migrate:allow-destructive: <reason>" if this is intended.',
    );
  }

  return { set, version, name, filename, sql, checksum: checksumOf(sql), transactional };
}

/** Reads and validates one set. Ordering is by version; duplicates and stray files are errors. */
export async function loadMigrationSet(set: MigrationSet): Promise<MigrationFile[]> {
  const entries = await readdir(set.directory, { withFileTypes: true });
  const files: MigrationFile[] = [];
  const seen = new Map<number, string>();

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'readme.md') continue;
    if (!entry.isFile()) {
      throw validationError(
        'migration.unexpected_entry',
        `Unexpected entry "${entry.name}" in migration set "${set.name}".`,
      );
    }

    // Anything that is not a well-formed migration is an error, never silently ignored:
    // a misnamed file would otherwise be skipped and the schema would quietly diverge.
    const parsed = parseMigration(
      set.name,
      entry.name,
      await readFile(path.join(set.directory, entry.name), 'utf8'),
    );

    const previous = seen.get(parsed.version);
    if (previous !== undefined) {
      throw validationError(
        'migration.duplicate_version',
        `Migration set "${set.name}" has two files with version ${parsed.version}: ${previous} and ${entry.name}.`,
      );
    }
    seen.set(parsed.version, entry.name);
    files.push(parsed);
  }

  return files.sort((a, b) => a.version - b.version);
}
