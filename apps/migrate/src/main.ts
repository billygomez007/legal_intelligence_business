import { baseEnvSchema, loadConfigFromProcessEnv } from '@legalintel/config';
import { runMigrationCli } from '@legalintel/db';

import { assertProductionSafety } from './guards';
import { allMigrationSets } from './sets';

const { APP_ENV } = loadConfigFromProcessEnv(baseEnvSchema.pick({ APP_ENV: true }));

await runMigrationCli(allMigrationSets, process.argv.slice(2), {
  afterCommand: ({ migratorUrl }) => assertProductionSafety(migratorUrl, APP_ENV),
});
