import {
  fileURLToPath,
} from 'node:url';

import type {
  MigrationSet,
} from '@legalintel/db';

export const legalRetrievalMigrations: MigrationSet = {
  name: 'legal_retrieval',

  directory: fileURLToPath(
    new URL(
      '../migrations',
      import.meta.url,
    ),
  ),
};
