import { fileURLToPath } from 'node:url';
import type { MigrationSet } from '@legalintel/db';
export const ingestionMigrations: MigrationSet = {
  name: 'ingestion',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
