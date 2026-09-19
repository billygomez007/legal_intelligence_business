import { defineConfig } from 'vitest/config';

/**
 * Two projects, one command each:
 *  - unit:        pure code, no external services. Runs on every save and in every CI job.
 *  - integration: real PostgreSQL. Never mocked; tenant isolation and rights enforcement are
 *                 properties of the database and can only be proven against it.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{apps,packages}/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['{apps,packages}/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
