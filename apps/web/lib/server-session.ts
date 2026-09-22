import { cookies } from 'next/headers';

const SESSION_COOKIE = 'law_afrique_session';

const SESSION_TTL_SECONDS = 60 * 60;

const API_BASE = process.env.LAW_AFRIQUE_API_URL ?? 'http://127.0.0.1:8080';

export interface LawAfriqueServerSession {
  readonly token: string;
}

export async function setLawAfriqueSessionCookie(token: string): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,

    secure: process.env.NODE_ENV === 'production',

    sameSite: 'lax',

    path: '/',

    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearLawAfriqueSessionCookie(): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, '', {
    httpOnly: true,

    secure: process.env.NODE_ENV === 'production',

    sameSite: 'lax',

    path: '/',

    maxAge: 0,
  });
}

export async function readLawAfriqueSession(): Promise<LawAfriqueServerSession | null> {
  const store = await cookies();

  const value = store.get(SESSION_COOKIE);

  if (typeof value?.value !== 'string' || value.value.length === 0) {
    return null;
  }

  return {
    token: value.value,
  };
}

export async function validateLawAfriqueSession(): Promise<boolean> {
  const session = await readLawAfriqueSession();

  if (session === null) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/v1/auth/session/validate`, {
      method: 'GET',

      headers: {
        authorization: `Bearer ${session.token}`,
      },

      cache: 'no-store',
    });

    if (response.status === 401) {
      return false;
    }

    if (!response.ok) {
      /**
       * Fail closed on unexpected backend responses.
       */
      return false;
    }

    const body = (await response.json()) as {
      readonly data?: {
        readonly authenticated?: unknown;
      };
    };

    return body?.data?.authenticated === true;
  } catch {
    /**
     * Authentication infrastructure unavailable:
     * deny protected-page access rather than
     * trusting an unverified browser cookie.
     */
    return false;
  }
}
