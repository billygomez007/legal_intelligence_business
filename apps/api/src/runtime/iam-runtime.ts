import type { DbPool } from '@legalintel/db';

import { pgIamStore, type IamDeps } from '@legalintel/iam';

import { createLawAfriquePermissionCatalog } from './permission-catalog.js';

export function createLawAfriqueIamRuntime(pool: DbPool): IamDeps {
  return Object.freeze({
    pool,

    store: pgIamStore,

    catalog: createLawAfriquePermissionCatalog(),

    clock: {
      now() {
        return new Date();
      },
    },
  });
}
