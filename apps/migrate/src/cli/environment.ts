import { ConfigError, deployEnvSchema, loadConfigFromProcessEnv } from '@legalintel/config';

/**
 * The environment this deploy runs in, or the end of the process.
 *
 * Migration and deploy tooling decides from APP_ENV whether production safety checks run, so the
 * environment must be stated, never assumed. Called first, so that a missing, blank or invalid
 * APP_ENV stops the process before any command can create roles, create a database or connect.
 * Generic application configuration keeps its development default; this entry point does not.
 */
export function requireDeployEnvironment(): string {
  try {
    return loadConfigFromProcessEnv(deployEnvSchema).APP_ENV;
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : String(error));
    // Exit code 2 is "bad usage" (see runMigrationCli); 1 is reserved for a failed command.
    process.exit(2);
  }
}
