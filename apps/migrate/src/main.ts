import { runMigrationCli } from '@legalintel/db';

import { requireDeployEnvironment } from './cli/environment';
import { assertProductionSafety } from './guards';
import { allMigrationSets } from './sets';

// First, before anything can touch persistent infrastructure: see ./cli/environment.ts.
const appEnv = requireDeployEnvironment();

await runMigrationCli(allMigrationSets, process.argv.slice(2), {
  afterCommand: ({ migratorUrl }) => assertProductionSafety(migratorUrl, appEnv),
});
