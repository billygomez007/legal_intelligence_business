import {
  authEnvSchema,
  databaseEnvSchema,
  deployEnvSchema,
  loadConfigFromProcessEnv,
  secret,
  type Secret,
} from '@legalintel/config';

import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535).default(8080);

const host = z.string().min(1).max(255).default('127.0.0.1');

const synthesis = z.object({
  LEGAL_SYNTHESIS_PROVIDER: z.literal('openai'),

  OPENAI_API_KEY: secret(8),

  OPENAI_LEGAL_SYNTHESIS_MODEL: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:/-]+$/u),

  GOOGLE_OIDC_CLIENT_ID: z
    .string()
    .min(8)
    .max(512)
    .regex(/^[A-Za-z0-9._:-]+$/u),

  OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
});

export const apiRuntimeEnvSchema = deployEnvSchema
  .merge(databaseEnvSchema)
  .merge(authEnvSchema)
  .merge(synthesis)
  .extend({
    API_HOST: host,

    API_PORT: port,
  });

export interface LawAfriqueApiRuntimeConfig {
  readonly appEnvironment: 'development' | 'test' | 'staging' | 'production';

  readonly databaseUrl: Secret;

  readonly databasePoolMax: number;

  readonly authSecret: Secret;

  readonly apiHost: string;

  readonly apiPort: number;

  readonly synthesisProvider: 'openai';

  readonly openAiApiKey: Secret;

  readonly openAiModel: string;

  readonly openAiTimeoutMs: number;

  readonly googleOidcClientId: string;
}

export function loadLawAfriqueApiRuntimeConfig(): LawAfriqueApiRuntimeConfig {
  const config = loadConfigFromProcessEnv(apiRuntimeEnvSchema);

  return Object.freeze({
    appEnvironment: config.APP_ENV,

    databaseUrl: config.DATABASE_URL,

    databasePoolMax: config.DATABASE_POOL_MAX,

    authSecret: config.AUTH_SECRET,

    apiHost: config.API_HOST,

    apiPort: config.API_PORT,

    synthesisProvider: config.LEGAL_SYNTHESIS_PROVIDER,

    openAiApiKey: config.OPENAI_API_KEY,

    openAiModel: config.OPENAI_LEGAL_SYNTHESIS_MODEL,

    openAiTimeoutMs: config.OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS,

    googleOidcClientId: config.GOOGLE_OIDC_CLIENT_ID,
  });
}
