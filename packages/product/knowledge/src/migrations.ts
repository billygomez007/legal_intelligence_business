import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const knowledgeMigrations: MigrationSet = {
  name: 'knowledge',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
