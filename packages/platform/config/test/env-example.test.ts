import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  authEnvSchema,
  baseEnvSchema,
  bootstrapEnvSchema,
  databaseEnvSchema,
  dataopsDatabaseEnvSchema,
  ingestDatabaseEnvSchema,
  migratorEnvSchema,
  telemetryEnvSchema,
} from '../src';

/**
 * `.env.example` is the contract a new developer copies. If a schema gains a variable and
 * the example does not, onboarding silently breaks; if the example gains a real credential,
 * we have leaked one. Both are checked here.
 */
const raw = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');

const entries = new Map<string, string>();
for (const line of raw.split('\n')) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (match?.[1] !== undefined) entries.set(match[1], match[2] ?? '');
}

const schemaKeys = [
  ...Object.keys(baseEnvSchema.shape),
  ...Object.keys(databaseEnvSchema.shape),
  ...Object.keys(authEnvSchema.shape),
  ...Object.keys(telemetryEnvSchema.shape),
  ...Object.keys(migratorEnvSchema.shape),
  ...Object.keys(ingestDatabaseEnvSchema.shape),
  ...Object.keys(dataopsDatabaseEnvSchema.shape),
  ...Object.keys(bootstrapEnvSchema.shape),
];

describe('.env.example', () => {
  it.each(schemaKeys)('documents %s', (key) => {
    expect(
      entries.has(key),
      `${key} is defined in a config schema but missing from .env.example`,
    ).toBe(true);
  });

  it('leaves every credential-like variable blank', () => {
    const credentialLike = /(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)/;
    const offenders = [...entries]
      .filter(([key, value]) => credentialLike.test(key) && value !== '')
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('never embeds a production hostname in a connection string', () => {
    for (const [key, value] of entries) {
      if (key.endsWith('URL') && value.includes('@')) {
        expect(value, key).toMatch(/@(localhost|127\.0\.0\.1|postgres)(:|\/|$)/);
      }
    }
  });
});
