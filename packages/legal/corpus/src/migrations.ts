import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const corpusMigrations: MigrationSet = {
  name: 'corpus',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
