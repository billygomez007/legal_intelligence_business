import { fileURLToPath } from 'node:url';

import { DB_ROLES } from '../roles';
import type { MigrationSet } from './files';

/** Product-agnostic schema: tenancy context, identity, audit. */
export const platformMigrations: MigrationSet = {
  name: 'platform',
  directory: fileURLToPath(new URL('../../migrations', import.meta.url)),
};

/** Roles that every migration set may grant privileges to. */
export const REQUIRED_ROLES: readonly string[] = Object.values(DB_ROLES);
