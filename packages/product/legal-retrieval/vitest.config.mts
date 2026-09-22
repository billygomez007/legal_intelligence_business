import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// eslint-disable-next-line no-restricted-properties -- Test-runner output configuration only; no application credentials or runtime config.
const report = process.env['LAWAFRIQUE_PHASE7_TEST_REPORT'];

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts'],
    environment: 'node',
    watch: false,
    allowOnly: false,
    passWithNoTests: false,
    reporters: report ? ['default', 'json'] : ['default'],
    ...(report ? { outputFile: { json: report } } : {}),
  },
});
