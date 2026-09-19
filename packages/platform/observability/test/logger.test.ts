import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, enrichContext, getContext, runWithContext } from '../src';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const records = () =>
    lines
      .join('')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { destination, records, raw: () => lines.join('') };
}

describe('logger redaction', () => {
  it('redacts credentials and content-bearing fields at any reasonable depth', () => {
    const sink = capture();
    const logger = createLogger({ service: 'test', destination: sink.destination });

    logger.info(
      {
        password: 'pw-root',
        token: 'token-root',
        user: { email: 'lawyer@firm.example', apiKey: 'key-level-1' },
        run: { retrieval: { passageText: 'confidential holding text' } },
        req: {
          headers: {
            authorization: 'Bearer abc.def.ghi',
            cookie: 'session=cookie-secret',
            'x-api-key': 'header-redaction-probe',
          },
        },
        res: { headers: { 'set-cookie': 'session=set-cookie-secret' } },
      },
      'request handled',
    );

    const output = sink.raw();
    for (const leaked of [
      'pw-root',
      'token-root',
      'lawyer@firm.example',
      'key-level-1',
      'confidential holding text',
      'Bearer abc.def.ghi',
      'cookie-secret',
      'header-redaction-probe',
      'set-cookie-secret',
    ]) {
      expect(output, `"${leaked}" must not appear in log output`).not.toContain(leaked);
    }
    expect(output).toContain('[REDACTED]');
    expect(sink.records()[0]?.['msg']).toBe('request handled');
  });

  it('keeps identifiers and versions, which are what audit logs need', () => {
    const sink = capture();
    const logger = createLogger({ service: 'test', destination: sink.destination });

    logger.info(
      { runId: 'run-1', passageId: 'p-9', model: 'model-x', promptVersion: 'v3' },
      'ai run completed',
    );

    expect(sink.records()[0]).toMatchObject({
      runId: 'run-1',
      passageId: 'p-9',
      model: 'model-x',
      promptVersion: 'v3',
    });
  });

  it('supports caller-supplied redaction paths', () => {
    const sink = capture();
    const logger = createLogger({
      service: 'test',
      destination: sink.destination,
      redactPaths: ['matterReference'],
    });
    logger.info({ matterReference: 'ACME v. Widget' }, 'x');
    expect(sink.raw()).not.toContain('ACME v. Widget');
  });

  it('includes service and environment on every line', () => {
    const sink = capture();
    createLogger({
      service: 'api',
      environment: 'staging',
      destination: sink.destination,
    }).info('hello');
    expect(sink.records()[0]).toMatchObject({ service: 'api', env: 'staging', level: 'info' });
  });
});

describe('request context', () => {
  it('is copied onto log lines emitted within the context', () => {
    const sink = capture();
    const logger = createLogger({ service: 'test', destination: sink.destination });

    runWithContext({ requestId: 'req-1', organizationId: 'org-1' }, () => {
      logger.info('inside');
    });
    logger.info('outside');

    const [inside, outside] = sink.records();
    expect(inside).toMatchObject({ requestId: 'req-1', organizationId: 'org-1' });
    expect(outside).not.toHaveProperty('requestId');
  });

  it('can be enriched after authentication and is isolated between concurrent requests', async () => {
    const seen: Record<string, string | undefined> = {};

    await Promise.all(
      ['a', 'b'].map((label) =>
        runWithContext({ requestId: `req-${label}` }, async () => {
          await new Promise((resolve) => setTimeout(resolve, label === 'a' ? 15 : 1));
          enrichContext({ organizationId: `org-${label}` });
          await new Promise((resolve) => setTimeout(resolve, 5));
          seen[label] = getContext()?.organizationId;
        }),
      ),
    );

    expect(seen).toEqual({ a: 'org-a', b: 'org-b' });
    expect(getContext()).toBeUndefined();
  });
});
