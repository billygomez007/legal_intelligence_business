import { describe, expect, it } from 'vitest';

import { APP_ENVIRONMENTS, ConfigError, baseEnvSchema, deployEnvSchema, loadConfig } from '../src';

/**
 * Deployment-sensitive entry points (migration and deploy tooling) decide whether production
 * safety checks run from APP_ENV. A default there would turn a forgotten variable into "safe to
 * skip the checks", so these entry points use a schema with no default.
 */
describe('deployEnvSchema', () => {
  it.each(APP_ENVIRONMENTS)('accepts an explicit %s', (environment) => {
    expect(loadConfig(deployEnvSchema, { APP_ENV: environment }).APP_ENV).toBe(environment);
  });

  it('lists exactly the four supported environments', () => {
    expect([...APP_ENVIRONMENTS]).toEqual(['development', 'test', 'staging', 'production']);
  });

  it('refuses a missing APP_ENV instead of assuming development', () => {
    expect(() => loadConfig(deployEnvSchema, {})).toThrow(ConfigError);
    expect(() => loadConfig(deployEnvSchema, {})).toThrow(/APP_ENV/);
  });

  it.each(['', '   ', '\n', '\t '])('refuses a blank APP_ENV (%j)', (blank) => {
    expect(() => loadConfig(deployEnvSchema, { APP_ENV: blank })).toThrow(/APP_ENV/);
  });

  it.each(['prod', 'live', 'Production', 'PRODUCTION', 'dev', 'stage', 'qa', 'production ;', '0'])(
    'refuses an invalid APP_ENV (%j)',
    (invalid) => {
      expect(() => loadConfig(deployEnvSchema, { APP_ENV: invalid })).toThrow(ConfigError);
    },
  );

  it('says what is accepted, so the operator can fix the deploy', () => {
    try {
      loadConfig(deployEnvSchema, { APP_ENV: 'prod' });
      expect.unreachable();
    } catch (error) {
      const message = (error as ConfigError).message;
      for (const environment of APP_ENVIRONMENTS) expect(message).toContain(environment);
    }
  });

  it('trims surrounding whitespace, as every configuration value is', () => {
    expect(loadConfig(deployEnvSchema, { APP_ENV: ' production\n' }).APP_ENV).toBe('production');
  });

  it('is the only schema without a default: generic configuration keeps its development default', () => {
    // Local developer ergonomics are unchanged; only deployment-sensitive roots opt out.
    expect(loadConfig(baseEnvSchema, {}).APP_ENV).toBe('development');
    expect(() => loadConfig(deployEnvSchema, {})).toThrow(ConfigError);
  });
});
