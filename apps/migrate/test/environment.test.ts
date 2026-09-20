import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { APP_ENVIRONMENTS } from '@legalintel/config';
import { describe, expect, it } from 'vitest';

/**
 * The migration entry point is where production safety checks are switched on, so it must not
 * guess the environment. These run the real entry point in a child process with a clean
 * environment, aimed at a port nothing listens on. That makes "did it touch persistent
 * infrastructure?" observable: a process that got past the environment check tries to connect
 * and reports ECONNREFUSED; one that was refused never tried.
 */
const APP_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const NOTHING_LISTENS = '127.0.0.1:1';

interface Outcome {
  readonly code: number | null;
  readonly output: string;
}

function run(command: string, environment: Record<string, string>): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', command], {
      cwd: APP_DIRECTORY,
      // Nothing is inherited: a stray APP_ENV in the developer's shell must not decide the result.
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        MIGRATOR_DATABASE_URL: `postgres://legalintel_migrator:unused@${NOTHING_LISTENS}/never`,
        DB_BOOTSTRAP_ADMIN_URL: `postgres://postgres:unused@${NOTHING_LISTENS}/postgres`,
        ...environment,
      },
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, output });
    });
  });
}

const REFUSED = /APP_ENV/;
const TRIED_TO_CONNECT = /ECONNREFUSED/;

describe('the migration entry point requires an explicit environment', () => {
  it.each(['status', 'migrate', 'setup', 'bootstrap'])(
    'refuses %s when APP_ENV is missing, before connecting to anything',
    async (command) => {
      const outcome = await run(command, {});
      expect(outcome.code).not.toBe(0);
      expect(outcome.output).toMatch(REFUSED);
      expect(outcome.output).not.toMatch(TRIED_TO_CONNECT);
    },
    30_000,
  );

  it.each([
    ['blank', ''],
    ['whitespace', '   '],
    ['invalid', 'prod'],
    ['wrongly cased', 'Production'],
    ['a near miss', 'production;'],
  ])(
    'refuses setup when APP_ENV is %s, before connecting to anything',
    async (_label, value) => {
      const outcome = await run('setup', { APP_ENV: value });
      expect(outcome.code).not.toBe(0);
      expect(outcome.output).toMatch(REFUSED);
      expect(outcome.output).not.toMatch(TRIED_TO_CONNECT);
    },
    30_000,
  );

  it.each(APP_ENVIRONMENTS)(
    'accepts an explicit %s and goes on to use the database',
    async (environment) => {
      const outcome = await run('status', { APP_ENV: environment });
      // Past the environment check, the only thing left to fail is the unreachable database.
      expect(outcome.output).toMatch(TRIED_TO_CONNECT);
      expect(outcome.output).not.toMatch(REFUSED);
    },
    30_000,
  );
});
