import { Writable } from 'node:stream';

import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { internalError } from '@legalintel/kernel';

import { createLogger, incrementCounter, recordHistogram, withSpan } from '../src';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
  contextManager.disable();
  context.disable();
  trace.disable();
});

beforeEach(() => {
  exporter.reset();
});

describe('withSpan', () => {
  it('creates a span with attributes and returns the result', async () => {
    const result = await withSpan('retrieval.hybrid', { 'retrieval.purpose': 'search' }, () => 42);

    expect(result).toBe(42);
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('retrieval.hybrid');
    expect(span?.attributes['retrieval.purpose']).toBe('search');
  });

  it('records error type and code but never the message', async () => {
    const secretDetail = 'SELECT * FROM passages WHERE text = $1 -- params: [confidential]';

    await expect(
      withSpan('db.query', {}, () => {
        throw internalError('db.query_failed', secretDetail);
      }),
    ).rejects.toMatchObject({ code: 'db.query_failed' });

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span?.attributes['error.type']).toBe('AppError');
    expect(span?.attributes['app.error.code']).toBe('db.query_failed');
    expect(JSON.stringify(span?.attributes)).not.toContain('confidential');
    expect(span?.status.message).toBeUndefined();
    expect(span?.events).toHaveLength(0);
  });

  it('propagates trace correlation identifiers into log lines', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'test',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString('utf8'));
          callback();
        },
      }),
    });

    await withSpan('unit', {}, () => {
      logger.info('inside span');
    });

    const record = JSON.parse(lines.join('')) as { traceId?: string; spanId?: string };
    const [span] = exporter.getFinishedSpans();
    expect(record.traceId).toBe(span?.spanContext().traceId);
    expect(record.spanId).toBe(span?.spanContext().spanId);
  });
});

describe('metrics facade', () => {
  it('is safe to call when no metrics SDK is registered', () => {
    expect(() => {
      incrementCounter('ingestion.items.processed', { stage: 'extract', outcome: 'ok' });
      incrementCounter('ingestion.items.processed', { stage: 'extract', outcome: 'ok' });
      recordHistogram('retrieval.latency_ms', 12.5, { purpose: 'search' });
    }).not.toThrow();
  });
});
