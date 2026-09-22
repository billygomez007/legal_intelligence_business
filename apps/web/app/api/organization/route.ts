import { NextResponse } from 'next/server';

import { createOrganization } from '../../../lib/workspace-api';

function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');

  const host = request.headers.get('host');

  if (origin === null || host === null) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json(
      {
        error: {
          code: 'origin_invalid',
        },
      },

      {
        status: 403,
      },
    );
  }

  const body = await request.json().catch(() => null);

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

  const name = record['name'];

  const kind = record['kind'];

  if (
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    typeof kind !== 'string' ||
    !['individual', 'firm', 'corporate', 'institution'].includes(kind)
  ) {
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

  const result = await createOrganization({
    name: name.trim(),

    kind: kind as 'individual' | 'firm' | 'corporate' | 'institution',
  });

  return NextResponse.json(
    result.ok
      ? {
          data: result.data,
        }
      : {
          error: {
            code: result.errorCode ?? 'organization_create_failed',
          },
        },

    {
      status: result.status,
    },
  );
}
