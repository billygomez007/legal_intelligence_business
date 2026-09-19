import { OrganizationId } from '@legalintel/kernel';
import { describe, expect, it } from 'vitest';

import {
  DUMMY_SECRET_HASH,
  generateApiKey,
  hashApiKeySecret,
  parseApiKey,
  verifyApiKeySecret,
} from '../src';

const org = OrganizationId.generate();

describe('API keys', () => {
  it('round-trips: what is generated parses back to the same identifiers', () => {
    const generated = generateApiKey(org);
    const parsed = parseApiKey(generated.plaintext);

    expect(parsed).not.toBeNull();
    expect(parsed?.organizationId).toBe(org);
    expect(parsed?.keyId).toBe(generated.keyId);
    expect(generated.plaintext).toMatch(/^lip1_[0-9a-f]{32}_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
  });

  it('generates a different secret every time', () => {
    expect(generateApiKey(org).plaintext).not.toBe(generateApiKey(org).plaintext);
  });

  it('verifies the right secret and rejects a wrong one', () => {
    const generated = generateApiKey(org);
    const secret = parseApiKey(generated.plaintext)?.secret ?? '';
    expect(verifyApiKeySecret(secret, generated.secretHash)).toBe(true);
    expect(
      verifyApiKeySecret(
        `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`,
        generated.secretHash,
      ),
    ).toBe(false);
    expect(verifyApiKeySecret('', generated.secretHash)).toBe(false);
  });

  it('stores only a hash, and the hash does not contain the secret', () => {
    const generated = generateApiKey(org);
    const secret = parseApiKey(generated.plaintext)?.secret ?? '';
    expect(generated.secretHash).toHaveLength(32);
    expect(generated.secretHash.toString('utf8')).not.toContain(secret);
    expect(generated.secretHash.equals(hashApiKeySecret(secret))).toBe(true);
    expect(generated.lastFour).toBe(secret.slice(-4));
  });

  it('never verifies against a hash of the wrong length', () => {
    expect(verifyApiKeySecret('anything', Buffer.alloc(16))).toBe(false);
    expect(verifyApiKeySecret('anything', new Uint8Array())).toBe(false);
  });

  it('has a dummy hash that no real secret matches, for constant-work "no such key" paths', () => {
    expect(DUMMY_SECRET_HASH).toHaveLength(32);
    expect(
      verifyApiKeySecret(
        parseApiKey(generateApiKey(org).plaintext)?.secret ?? '',
        DUMMY_SECRET_HASH,
      ),
    ).toBe(false);
  });

  describe('parseApiKey returns null for anything malformed and never throws', () => {
    const good = generateApiKey(org).plaintext;
    const cases: [string, string][] = [
      ['empty', ''],
      ['garbage', 'not a key'],
      ['wrong version', good.replace('lip1_', 'lip2_')],
      ['truncated', good.slice(0, -1)],
      ['extra suffix', `${good}x`],
      [
        'uppercase hex',
        good.replace(/_([0-9a-f]{32})_/, (_m, hex: string) => `_${hex.toUpperCase()}_`),
      ],
      ['bad characters in secret', `${good.slice(0, -1)}!`],
      ['nil organization id', good.replace(/_[0-9a-f]{32}_/, `_${'0'.repeat(32)}_`)],
      ['whitespace padding', ` ${good} `],
      ['newline injection', `${good}\nSELECT 1`],
      ['very long input', 'lip1_'.repeat(50_000)],
    ];
    it.each(cases)('%s', (_label, input) => {
      expect(parseApiKey(input)).toBeNull();
    });
  });
});
