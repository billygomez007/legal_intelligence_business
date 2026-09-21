import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const workspaceMigrations: MigrationSet = {
  name: 'workspace',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
