import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const workProductMigrations: MigrationSet = {
  name: 'work_products',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
