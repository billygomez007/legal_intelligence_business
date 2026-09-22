import { NextResponse } from 'next/server';

import { setLawAfriqueSessionCookie } from '../../../../lib/server-session';

const API_BASE = process.env.LAW_AFRIQUE_API_URL ?? 'http://127.0.0.1:8080';

const MAX_BODY_BYTES = 32 * 1024;

interface UpstreamSessionResponse {
  readonly data?: {
    readonly sessionToken?: unknown;
    readonly tokenType?: unknown;
    readonly expiresInSeconds?: unknown;
  };

  readonly error?: {
    readonly code?: unknown;
  };
}

export async function POST(request: Request) {
  const raw = await request.text();

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: 'request_too_large',
        },
      },
      {
        status: 413,
      },
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'request_invalid',
        },
      },
      {
        status: 400,
      },
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      {
        error: {
          code: 'request_invalid',
        },
      },
      {
        status: 400,
      },
    );
  }

  const record = body as Record<string, unknown>;

  if (Object.keys(record).length !== 1 || typeof record.credential !== 'string') {
    return NextResponse.json(
      {
        error: {
          code: 'request_invalid',
        },
      },
      {
        status: 400,
      },
    );
  }

  try {
    const upstream = await fetch(`${API_BASE}/v1/auth/session`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        provider: 'google',

        credential: record.credential,
      }),

      cache: 'no-store',
    });

    const responseBody = (await upstream.json()) as UpstreamSessionResponse;

    if (!upstream.ok) {
      return NextResponse.json(responseBody, {
        status: upstream.status,
      });
    }

    const token = responseBody?.data?.sessionToken;

    const expiresInSeconds = responseBody?.data?.expiresInSeconds;

    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      typeof expiresInSeconds !== 'number' ||
      expiresInSeconds <= 0
    ) {
      return NextResponse.json(
        {
          error: {
            code: 'authentication_failed',
          },
        },
        {
          status: 502,
        },
      );
    }

    await setLawAfriqueSessionCookie(token);

    return NextResponse.json(
      {
        data: {
          authenticated: true,

          expiresInSeconds,
        },
      },
      {
        status: 200,
      },
    );
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'authentication_service_unavailable',
        },
      },
      {
        status: 503,
      },
    );
  }
}
