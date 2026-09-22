import { NextResponse } from 'next/server';

import { researchPost } from '../../../lib/workspace-api';

export async function POST(request: Request) {
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

  const result = await researchPost(body as Record<string, unknown>);

  return NextResponse.json(
    result.payload,

    {
      status: result.status,
    },
  );
}
