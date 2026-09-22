import { NextResponse } from 'next/server';

import { workspaceUpload } from '../../../lib/workspace-api';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

  const form = await request.formData().catch(() => null);

  if (form === null) {
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

  const documentId = form.get('documentId');

  const file = form.get('file');

  if (
    typeof documentId !== 'string' ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > MAX_FILE_BYTES
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'file_invalid_or_too_large',
        },
      },

      {
        status: 413,
      },
    );
  }

  const result = await workspaceUpload('/v1/workspace/documents/upload', documentId, file);

  return NextResponse.json(
    result.ok
      ? {
          data: result.data,
        }
      : {
          error: {
            code: result.errorCode ?? 'upload_failed',
          },
        },

    {
      status: result.status,
    },
  );
}
