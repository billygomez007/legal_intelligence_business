import { describe, expect, it } from 'vitest';

import { loadConfig } from '@legalintel/config';

import { apiRuntimeEnvSchema } from '../src/runtime/api-config.js';

const valid = {
  APP_ENV: 'test',

  DATABASE_URL: 'postgres://legalintel_app:unused@localhost:5432/legalintel',

  DATABASE_POOL_MAX: '5',

  AUTH_SECRET: 'law-afrique-auth-secret-that-is-definitely-longer-than-32-bytes',

  API_HOST: '127.0.0.1',

  API_PORT: '8080',

  LEGAL_SYNTHESIS_PROVIDER: 'openai',

  OPENAI_API_KEY: 'synthetic-openai-key',

  OPENAI_LEGAL_SYNTHESIS_MODEL: 'synthetic-model',

  OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS: '30000',

  GOOGLE_OIDC_CLIENT_ID: '123456789-law-afrique.apps.googleusercontent.com',
} as const;

describe('Phase 10C3 API runtime configuration', () => {
  it('loads secrets as redacted Secret wrappers', () => {
    const config = loadConfig(apiRuntimeEnvSchema, valid);

    expect(String(config.DATABASE_URL)).toBe('[REDACTED]');

    expect(String(config.AUTH_SECRET)).toBe('[REDACTED]');

    expect(String(config.OPENAI_API_KEY)).toBe('[REDACTED]');
  });

  it('requires APP_ENV rather than silently defaulting deployment mode', () => {
    const { APP_ENV: _, ...withoutAppEnvironment } = valid;

    expect(() => loadConfig(apiRuntimeEnvSchema, withoutAppEnvironment)).toThrow();
  });

  it('requires explicit OpenAI provider activation', () => {
    expect(() =>
      loadConfig(apiRuntimeEnvSchema, {
        ...valid,

        LEGAL_SYNTHESIS_PROVIDER: 'disabled',
      }),
    ).toThrow();
  });

  it('bounds network port and provider timeout', () => {
    expect(() =>
      loadConfig(apiRuntimeEnvSchema, {
        ...valid,

        API_PORT: '70000',
      }),
    ).toThrow();

    expect(() =>
      loadConfig(apiRuntimeEnvSchema, {
        ...valid,

        OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS: '999999',
      }),
    ).toThrow();
  });

  it('requires a Google OIDC client ID for the real sign-in adapter', () => {
    const { GOOGLE_OIDC_CLIENT_ID: _, ...withoutGoogleClientId } = valid;

    expect(() => loadConfig(apiRuntimeEnvSchema, withoutGoogleClientId)).toThrow();
  });
});
