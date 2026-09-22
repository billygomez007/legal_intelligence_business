import { NextResponse } from 'next/server';

import { activeOrganization, workspaceGet, workspacePost } from '../../../lib/workspace-api';

export async function GET(request: Request) {
  const url = new URL(request.url);

  const resource = url.searchParams.get('resource');

  if (resource === 'organization') {
    const data = await activeOrganization();

    return NextResponse.json({
      data,
    });
  }

  const paths: Record<string, string> = {
    matters: '/v1/workspace/matters',

    documents: '/v1/workspace/documents',

    workProducts: '/v1/workspace/work-products',

    approvals: '/v1/workspace/approvals',
  };

  const path = resource === null ? undefined : paths[resource];

  if (path === undefined) {
    return NextResponse.json(
      {
        error: {
          code: 'resource_invalid',
        },
      },

      {
        status: 400,
      },
    );
  }

  const data = await workspaceGet<unknown>(path);

  return NextResponse.json({
    data,
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  const resource = url.searchParams.get('resource');

  if (resource !== 'matters') {
    return NextResponse.json(
      {
        error: {
          code: 'resource_invalid',
        },
      },

      {
        status: 400,
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

  const result = await workspacePost(
    '/v1/workspace/matters',

    body as Record<string, unknown>,
  );

  return NextResponse.json(
    result.ok
      ? {
          data: result.data,
        }
      : {
          error: {
            code: result.errorCode ?? 'request_failed',
          },
        },

    {
      status: result.status,
    },
  );
}
