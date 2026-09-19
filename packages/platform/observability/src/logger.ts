import { trace } from '@opentelemetry/api';
import pino, { type DestinationStream, type Logger } from 'pino';

import { getContext } from './context';

/**
 * Field names that must never appear in a log line. This is a deny-list of *names*, chosen
 * because legal-platform logs must carry identifiers and versions, not document text, query
 * text or credentials (docs/17_SECURITY_PRIVACY.md, AGENTS.md). Deliberately broad: a
 * developer who genuinely needs to log something called `text` can name it differently.
 */
export const SENSITIVE_FIELD_NAMES = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'apiKey',
  'api_key',
  'privateKey',
  'connectionString',
  'databaseUrl',
  'email',
  'query',
  'queryText',
  'prompt',
  'completion',
  'text',
  'content',
  'body',
  'documentText',
  'passageText',
] as const;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const WILDCARD_PREFIXES = ['', '*.', '*.*.', '*.*.*.'] as const;

/**
 * pino redaction supports single-level wildcards only, so each plain name is registered at
 * the root and up to three levels deep. Hyphenated names (HTTP headers) need bracket syntax
 * and are registered at the root plus the standard request/response header locations.
 */
export function buildRedactPaths(extra: readonly string[] = []): string[] {
  const paths = new Set<string>(extra);
  for (const name of SENSITIVE_FIELD_NAMES) {
    if (IDENTIFIER.test(name)) {
      for (const prefix of WILDCARD_PREFIXES) paths.add(`${prefix}${name}`);
    } else {
      paths.add(`["${name}"]`);
    }
  }
  for (const header of ['authorization', 'cookie', 'x-api-key']) {
    paths.add(`req.headers["${header}"]`);
    paths.add(`headers["${header}"]`);
  }
  paths.add('res.headers["set-cookie"]');
  paths.add('headers["set-cookie"]');
  return [...paths];
}

export interface LoggerConfig {
  readonly service: string;
  readonly environment?: string;
  readonly level?: string;
  readonly redactPaths?: readonly string[];
  /** Overridable so tests can capture output. Defaults to stdout. */
  readonly destination?: DestinationStream;
}

export function createLogger(config: LoggerConfig): Logger {
  const options = {
    level: config.level ?? 'info',
    base: { service: config.service, env: config.environment ?? 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: buildRedactPaths(config.redactPaths), censor: '[REDACTED]' },
    serializers: { err: pino.stdSerializers.err },
    mixin: () => {
      const context = getContext();
      const spanContext = trace.getActiveSpan()?.spanContext();
      return {
        ...(context ?? {}),
        ...(spanContext === undefined
          ? {}
          : { traceId: spanContext.traceId, spanId: spanContext.spanId }),
      };
    },
  };
  return config.destination === undefined ? pino(options) : pino(options, config.destination);
}

export type { Logger };
