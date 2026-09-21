import { fileURLToPath } from 'node:url';

import type { MigrationSet } from '@legalintel/db';

export const matterDocumentMigrations: MigrationSet = {
  name: 'matter_documents',
  directory: fileURLToPath(new URL('../migrations', import.meta.url)),
};
