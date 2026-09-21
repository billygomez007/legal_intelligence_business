import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const entitlementMigrations: MigrationSet = {
  name: 'entitlements',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
