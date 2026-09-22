import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 32 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('request_too_large');

    this.name = 'RequestBodyTooLargeError';
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super('request_invalid_json');

    this.name = 'InvalidJsonBodyError';
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<{
  readonly body: unknown;

  readonly byteLength: number;
}> {
  const chunks: Buffer[] = [];

  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    total += buffer.byteLength;

    if (total > MAX_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (raw.trim().length === 0) {
    throw new InvalidJsonBodyError();
  }

  try {
    return {
      body: JSON.parse(raw) as unknown,

      byteLength: total,
    };
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export function sendJson(
  response: ServerResponse,

  status: number,

  body: unknown,
): void {
  const payload = JSON.stringify(body);

  response.statusCode = status;

  response.setHeader('content-type', 'application/json; charset=utf-8');

  response.setHeader('cache-control', 'no-store');

  response.setHeader('x-content-type-options', 'nosniff');

  response.end(payload);
}
