import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const auditMigrations: MigrationSet = {
  name: 'audit',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
