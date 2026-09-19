import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  Secret,
  authEnvSchema,
  baseEnvSchema,
  databaseEnvSchema,
  loadConfig,
  withProductionGuards,
} from '../src';

const appSchema = withProductionGuards(
  baseEnvSchema.extend(databaseEnvSchema.shape).extend(authEnvSchema.shape),
);

const validEnv = {
  DATABASE_URL: 'postgres://legalintel_app:pw@localhost:5432/legalintel',
  AUTH_SECRET: 'a-secret-that-is-comfortably-longer-than-32-chars',
};

describe('loadConfig', () => {
  it('applies defaults and returns typed values', () => {
    const config = loadConfig(appSchema, validEnv);
    expect(config.APP_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.DATABASE_URL).toBeInstanceOf(Secret);
  });

  it('treats blank values as unset and trims whitespace', () => {
    const config = loadConfig(appSchema, {
      ...validEnv,
      LOG_LEVEL: '   ',
      AUTH_SECRET: `  ${validEnv.AUTH_SECRET}\n`,
    });
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.AUTH_SECRET.reveal()).toBe(validEnv.AUTH_SECRET);
  });

  it('coerces numeric values and enforces bounds', () => {
    expect(loadConfig(appSchema, { ...validEnv, DATABASE_POOL_MAX: '25' }).DATABASE_POOL_MAX).toBe(
      25,
    );
    expect(() => loadConfig(appSchema, { ...validEnv, DATABASE_POOL_MAX: '0' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig(appSchema, { ...validEnv, DATABASE_POOL_MAX: 'many' })).toThrow(
      ConfigError,
    );
  });

  it('names every invalid variable in one error', () => {
    try {
      loadConfig(appSchema, { APP_ENV: 'prod' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const variables = (error as ConfigError).issues.map((issue) => issue.variable).sort();
      expect(variables).toEqual(['APP_ENV', 'AUTH_SECRET', 'DATABASE_URL']);
    }
  });

  it('never echoes rejected values, because they may be credentials', () => {
    try {
      loadConfig(appSchema, {
        DATABASE_URL: 'mysql://admin:hunter2-password@db.internal/legal',
        AUTH_SECRET: 'too-short-but-real-secret',
      });
      expect.unreachable();
    } catch (error) {
      const text = `${(error as ConfigError).message} ${JSON.stringify((error as ConfigError).issues)}`;
      expect(text).not.toContain('hunter2-password');
      expect(text).not.toContain('too-short-but-real-secret');
      expect(text).toContain('DATABASE_URL');
      expect(text).toContain('AUTH_SECRET');
    }
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => loadConfig(appSchema, { ...validEnv, DATABASE_URL: 'mysql://x/y' })).toThrow(
      ConfigError,
    );
  });
});

describe('production guards', () => {
  it('require https for the application URL in production only', () => {
    const insecure = { ...validEnv, APP_URL: 'http://example.com' };
    expect(() => loadConfig(appSchema, { ...insecure, APP_ENV: 'production' })).toThrow(/APP_URL/);
    expect(loadConfig(appSchema, { ...insecure, APP_ENV: 'staging' }).APP_ENV).toBe('staging');
    expect(
      loadConfig(appSchema, {
        ...validEnv,
        APP_URL: 'https://app.example.com',
        APP_ENV: 'production',
      }).APP_ENV,
    ).toBe('production');
  });
});

describe('Secret', () => {
  const secret = new Secret('super-secret-value');

  it('never reveals its value through common serialization paths', () => {
    expect(String(secret)).toBe('[REDACTED]');
    expect(`token=${String(secret)}`).not.toContain('super-secret-value');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(inspect(secret)).not.toContain('super-secret-value');
    expect(inspect({ nested: { secret } }, { depth: 5 })).not.toContain('super-secret-value');
  });

  it('reveals its value only through the explicit accessor', () => {
    expect(secret.reveal()).toBe('super-secret-value');
  });
});
