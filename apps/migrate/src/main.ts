import { runMigrationCli } from '@legalintel/db';

import { allMigrationSets } from './sets';

await runMigrationCli(allMigrationSets);
