import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const aiTaskMigrations: MigrationSet = {
  name: 'ai_tasks',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
