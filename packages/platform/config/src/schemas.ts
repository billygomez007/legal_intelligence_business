import { z } from 'zod';

import { Secret } from './secret';

export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** A required credential, minimum length enforced, wrapped so it cannot be logged by accident. */
export const secret = (minLength = 1) =>
  z
    .string()
    .min(minLength)
    .transform((value) => new Secret(value));

/**
 * A PostgreSQL connection string. Validated by scheme only; the custom message deliberately
 * omits the value because connection strings embed passwords.
 */
export const postgresUrl = () =>
  z
    .string()
    .refine((value) => /^postgres(ql)?:\/\//i.test(value), {
      message: 'must be a postgres:// or postgresql:// URL',
    })
    .transform((value) => new Secret(value));

export const baseEnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVIRONMENTS).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: postgresUrl(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
});

export const authEnvSchema = z.object({
  AUTH_SECRET: secret(32),
});

export const telemetryEnvSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});

type BaseEnv = z.output<typeof baseEnvSchema>;

/**
 * Cross-field rules that only apply in production. Applied by `withProductionGuards`.
 * Failing here stops the process at startup, which is the point.
 */
export function withProductionGuards<S extends z.ZodType<BaseEnv>>(schema: S) {
  return schema.superRefine((config, ctx) => {
    if (config.APP_ENV !== 'production') return;
    if (!config.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'must use https:// in production',
      });
    }
  });
}
