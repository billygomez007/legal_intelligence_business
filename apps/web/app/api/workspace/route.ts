import { NextResponse } from 'next/server';

import {
  activeOrganization,
  workspaceGet,
  workspacePatch,
  workspacePost,
} from '../../../lib/workspace-api';

function sameOrigin(request: Request): boolean {
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

function pathFor(resource: string | null): string | null {
  switch (resource) {
    case 'clients':
      return '/v1/workspace/clients';

    case 'matters':
      return '/v1/workspace/matters';

    case 'documents':
      return '/v1/workspace/documents';

    case 'workProducts':
      return '/v1/workspace/work-products';

    case 'approvals':
      return '/v1/workspace/approvals';

    default:
      return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const resource = url.searchParams.get('resource');

  if (resource === 'organization') {
    const data = await activeOrganization();

    return NextResponse.json({
      data,
    });
  }

  const path = pathFor(resource);

  if (path === null) {
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
  if (!sameOrigin(request)) {
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

  const url = new URL(request.url);

  const resource = url.searchParams.get('resource');

  if (resource !== 'clients' && resource !== 'matters' && resource !== 'documents') {
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

  const path =
    resource === 'clients'
      ? '/v1/workspace/clients'
      : resource === 'documents'
        ? '/v1/workspace/documents'
        : '/v1/workspace/matters';

  const result = await workspacePost(
    path,

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

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
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

  const url = new URL(request.url);

  const resource = url.searchParams.get('resource');

  if (resource !== 'clients' && resource !== 'documents') {
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

  const result = await workspacePatch(
    resource === 'documents' ? '/v1/workspace/documents' : '/v1/workspace/clients',

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
