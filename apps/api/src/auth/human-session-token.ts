import { createHmac, timingSafeEqual } from 'node:crypto';

import { UserId, type UserId as UserIdType } from '@legalintel/kernel';

import type { HumanSessionIdentityResolver } from './iam-request-auth.js';

const VERSION = 'v1';

const AUDIENCE = 'law-afrique-api';

const MAX_TOKEN_BYTES = 4096;

const MAX_SESSION_SECONDS = 24 * 60 * 60;

interface HumanSessionPayload {
  readonly sub: string;

  readonly aud: typeof AUDIENCE;

  readonly iat: number;

  readonly exp: number;
}

export interface HumanSessionClock {
  now(): Date;
}

export interface CreateHumanSessionTokenInput {
  readonly userId: UserIdType;

  readonly expiresInSeconds: number;
}

export interface SignedHumanSessionDependencies {
  readonly secret: string;

  readonly clock?: HumanSessionClock;
}

function nowSeconds(clock: HumanSessionClock): number {
  return Math.floor(clock.now().getTime() / 1000);
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): Buffer | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }

  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
}

function signingInput(payload: string): string {
  return `${VERSION}.${payload}`;
}

function sign(
  secret: string,

  payload: string,
): Buffer {
  return createHmac('sha256', secret).update(signingInput(payload), 'utf8').digest();
}

function validSecret(secret: string): boolean {
  return secret.length >= 32 && secret.length <= 4096 && !secret.includes('\0');
}

function exactPayload(value: unknown): HumanSessionPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  const keys = Object.keys(record).sort();

  if (keys.join(',') !== 'aud,exp,iat,sub') {
    return null;
  }

  if (
    typeof record['sub'] !== 'string' ||
    record['aud'] !== AUDIENCE ||
    typeof record['iat'] !== 'number' ||
    typeof record['exp'] !== 'number' ||
    !Number.isSafeInteger(record['iat']) ||
    !Number.isSafeInteger(record['exp'])
  ) {
    return null;
  }

  return {
    sub: record['sub'],

    aud: AUDIENCE,

    iat: record['iat'],

    exp: record['exp'],
  };
}

export function createSignedHumanSessionToken(
  dependencies: SignedHumanSessionDependencies,

  input: CreateHumanSessionTokenInput,
): string {
  if (!validSecret(dependencies.secret)) {
    throw new Error('human_session.secret_invalid');
  }

  if (
    !Number.isSafeInteger(input.expiresInSeconds) ||
    input.expiresInSeconds < 60 ||
    input.expiresInSeconds > MAX_SESSION_SECONDS
  ) {
    throw new Error('human_session.ttl_invalid');
  }

  const clock = dependencies.clock ?? {
    now: () => new Date(),
  };

  const iat = nowSeconds(clock);

  const payload: HumanSessionPayload = {
    sub: String(input.userId),

    aud: AUDIENCE,

    iat,

    exp: iat + input.expiresInSeconds,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const signature = base64UrlEncode(sign(dependencies.secret, encodedPayload));

  return [VERSION, encodedPayload, signature].join('.');
}

export function createSignedHumanSessionIdentityResolver(
  dependencies: SignedHumanSessionDependencies,
): HumanSessionIdentityResolver {
  if (!validSecret(dependencies.secret)) {
    throw new Error('human_session.secret_invalid');
  }

  const clock = dependencies.clock ?? {
    now: () => new Date(),
  };

  return Object.freeze({
    async resolveBearer(token: string): Promise<UserIdType | null> {
      if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
        return null;
      }

      const parts = token.split('.');

      if (parts.length !== 3) {
        return null;
      }

      const [version, encodedPayload, encodedSignature] = parts;

      if (version !== VERSION || encodedPayload === undefined || encodedSignature === undefined) {
        return null;
      }

      const suppliedSignature = base64UrlDecode(encodedSignature);

      if (suppliedSignature === null) {
        return null;
      }

      const expectedSignature = sign(dependencies.secret, encodedPayload);

      if (
        suppliedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedSignature, expectedSignature)
      ) {
        return null;
      }

      const decodedPayload = base64UrlDecode(encodedPayload);

      if (decodedPayload === null) {
        return null;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(decodedPayload.toString('utf8')) as unknown;
      } catch {
        return null;
      }

      const payload = exactPayload(parsed);

      if (payload === null) {
        return null;
      }

      const now = nowSeconds(clock);

      if (
        payload.iat > now + 60 ||
        payload.exp <= now ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > MAX_SESSION_SECONDS
      ) {
        return null;
      }

      try {
        return UserId.parse(payload.sub);
      } catch {
        return null;
      }
    },
  });
}
