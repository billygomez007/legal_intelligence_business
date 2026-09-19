import { AppError } from '@legalintel/kernel';
import type { z } from 'zod';

export interface ConfigIssue {
  readonly variable: string;
  readonly problem: string;
}

/**
 * Lists which variables are wrong and why, and never their values: a rejected secret
 * must not end up in a crash log.
 */
export class ConfigError extends AppError {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const summary = issues.map((issue) => `${issue.variable}: ${issue.problem}`).join('; ');
    super('internal', 'config.invalid', `Invalid configuration. ${summary}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Empty values are treated as unset (so a blank line in `.env` behaves like an absent
 * variable) and surrounding whitespace is trimmed (a trailing newline in a secret injected
 * from a file is a classic source of authentication failures).
 */
function normalize(source: EnvSource): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed !== '') result[key] = trimmed;
  }
  return result;
}

export function loadConfig<S extends z.ZodType>(schema: S, source: EnvSource): z.output<S> {
  const parsed = schema.safeParse(normalize(source));
  if (parsed.success) return parsed.data;

  throw new ConfigError(
    parsed.error.issues.map((issue) => ({
      variable: issue.path.length > 0 ? issue.path.join('.') : '(config)',
      problem: issue.message,
    })),
  );
}

/**
 * The only place in the codebase that reads `process.env` (enforced by lint). Application
 * entry points call this once at startup; everything else receives typed configuration.
 */
export function loadConfigFromProcessEnv<S extends z.ZodType>(schema: S): z.output<S> {
  return loadConfig(schema, process.env);
}
