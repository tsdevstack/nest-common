import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import { MESSAGING_TRACER_NAME } from '../telemetry/telemetry.constants';
import type { IncomingMessage } from './messaging.interface';

/**
 * Runs a message's handler in a span of the publisher's trace (from the
 * entry's traceparent field), so the handler's work (database queries,
 * calls to other services) joins the request that published the message.
 * A message without trace fields starts a trace of its own.
 */
export async function runMessageHandler(
  handler: (message: IncomingMessage) => Promise<void>,
  message: IncomingMessage,
  fields: string[],
): Promise<void> {
  const carrier: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    carrier[fields[i]] = fields[i + 1];
  }
  const parent = propagation.extract(ROOT_CONTEXT, carrier);

  const span = trace.getTracer(MESSAGING_TRACER_NAME).startSpan(
    `process ${message.topic}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.operation.type': 'process',
        'messaging.destination.name': message.topic,
        'messaging.message.id': message.id,
        'messaging.message.delivery_count': message.retryCount,
      },
    },
    parent,
  );

  try {
    await context.with(trace.setSpan(parent, span), () => handler(message));
  } catch (error) {
    span.recordException(
      error instanceof Error ? error : new Error(String(error)),
    );
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
