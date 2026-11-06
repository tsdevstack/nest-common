import {
  context as otelContext,
  trace,
  INVALID_SPAN_CONTEXT,
  type Context,
} from '@opentelemetry/api';
import { SpanKind, type Span, type SpanOptions, type Tracer } from 'bullmq';
import { BullMQOTelSpan } from 'bullmq-otel';

/**
 * BullMQ's tracer, without the queue's own housekeeping.
 *
 * Workers run timers (stalled job checks, lock renewals, event trimming)
 * that BullMQ traces as internal spans. Outside a request or job they
 * would start a new trace every few seconds per queue, so they are not
 * recorded. Queuing a job, processing it and every span inside a trace
 * are kept.
 */
export class BullMqJobTracer implements Tracer<Context> {
  constructor(private readonly tracer: Tracer<Context>) {}

  startSpan(name: string, options?: SpanOptions, context?: Context): Span {
    const parent = trace.getSpan(context ?? otelContext.active());

    if (options?.kind === SpanKind.INTERNAL && !parent) {
      return new BullMQOTelSpan(trace.wrapSpanContext(INVALID_SPAN_CONTEXT));
    }

    return this.tracer.startSpan(name, options, context);
  }
}
