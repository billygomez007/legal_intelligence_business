import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { ApiKeyId, OrganizationId } from '@legalintel/kernel';

/**
 * API key format:  lip1_<organization id, 32 hex>_<key id, 32 hex>_<secret, 43 base64url>
 *
 * The organization and key ids are not secret. Carrying them in the key lets the server open
 * the right tenant context *before* looking anything up, so lookups run under ordinary
 * row-level security instead of needing a privileged cross-tenant query. Only the 256-bit
 * secret authenticates; a forged organization id gains nothing without it.
 *
 * `lip1` is a format version so the scheme can change without ambiguity.
 */
const FORMAT = /^lip1_([0-9a-f]{32})_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

const toHex = (uuid: string) => uuid.replaceAll('-', '');
const fromHex = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

export interface GeneratedApiKey {
  /** Shown to the user exactly once. Never stored, never logged. */
  readonly plaintext: string;
  readonly keyId: ApiKeyId;
  readonly secretHash: Buffer;
  /** For display ("…a1b2") so users can tell keys apart without seeing them. */
  readonly lastFour: string;
}

export interface ParsedApiKey {
  readonly organizationId: OrganizationId;
  readonly keyId: ApiKeyId;
  readonly secret: string;
}

/**
 * SHA-256, not a password hash: the secret is 256 bits of randomness, so there is nothing to
 * brute-force, and a fast hash keeps per-request authentication cheap.
 */
export function hashApiKeySecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function generateApiKey(organizationId: OrganizationId): GeneratedApiKey {
  const keyId = ApiKeyId.generate();
  const secret = randomBytes(32).toString('base64url');
  return {
    plaintext: `lip1_${toHex(organizationId)}_${toHex(keyId)}_${secret}`,
    keyId,
    secretHash: hashApiKeySecret(secret),
    lastFour: secret.slice(-4),
  };
}

/** Returns null for anything malformed. Never throws on hostile input. */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const match = FORMAT.exec(raw);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  const organizationId = fromHex(match[1]);
  const keyId = fromHex(match[2]);
  if (!OrganizationId.is(organizationId) || !ApiKeyId.is(keyId)) return null;
  return { organizationId, keyId, secret: match[3] };
}

/** Constant-time comparison. */
export function verifyApiKeySecret(secret: string, storedHash: Uint8Array): boolean {
  const candidate = hashApiKeySecret(secret);
  return storedHash.length === candidate.length && timingSafeEqual(candidate, storedHash);
}

/**
 * Compared against when no key row exists, so "no such key" costs the same CPU as "wrong
 * secret" and response time does not reveal which keys exist.
 */
export const DUMMY_SECRET_HASH = hashApiKeySecret('no-such-key');
