import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const iamMigrations: MigrationSet = {
  name: 'iam',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
