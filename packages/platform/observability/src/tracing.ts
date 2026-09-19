import { isAppError } from '@legalintel/kernel';
import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('@legalintel/observability');

/**
 * Runs `fn` inside an active span. Without an OpenTelemetry SDK registered this is a no-op,
 * so library code can always call it.
 *
 * On failure the span records the error *type and code* but deliberately not the message or
 * stack: messages routinely embed query parameters or document fragments, and traces are
 * often shipped to third-party backends. The full error goes to the (redacting) logger.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.setAttribute('error.type', error instanceof Error ? error.name : 'unknown');
      if (isAppError(error)) span.setAttribute('app.error.code', error.code);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
