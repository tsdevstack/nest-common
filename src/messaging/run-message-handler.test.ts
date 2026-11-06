import {
  describe,
  it,
  expect,
  rs,
  beforeAll,
  afterAll,
  beforeEach,
} from '@rstest/core';
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { runMessageHandler } from './run-message-handler';
import type { IncomingMessage } from './messaging.interface';

const TRACE_ID = '5759e988bd862e3fe1be46a994272793';
const PUBLISH_SPAN_ID = '7d0e9b68a33bca06';

const message: IncomingMessage = {
  id: '1709312000000-0',
  topic: 'user-registered',
  data: { userId: '42' },
  publishedAt: new Date(1709312000000),
  retryCount: 0,
};

const tracedFields = [
  'data',
  '{"userId":"42"}',
  'traceparent',
  `00-${TRACE_ID}-${PUBLISH_SPAN_ID}-01`,
];

describe('runMessageHandler', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new TracerProvider({
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
      }),
    );
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterAll(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  describe('Standard use cases', () => {
    it("should run the handler in the publisher's trace", async () => {
      let activeTraceId: string | undefined;
      const handler = rs.fn(async () => {
        activeTraceId = trace.getActiveSpan()?.spanContext().traceId;
      });

      await runMessageHandler(handler, message, tracedFields);

      const [span] = exporter.getFinishedSpans();
      expect(handler).toHaveBeenCalledWith(message);
      expect(span.name).toBe('process user-registered');
      expect(span.kind).toBe(SpanKind.CONSUMER);
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(span.parentSpanContext?.spanId).toBe(PUBLISH_SPAN_ID);
      // Queries and calls inside the handler join the same trace
      expect(activeTraceId).toBe(TRACE_ID);
    });
  });

  describe('Edge cases', () => {
    it('should start a trace of its own for a message without trace fields', async () => {
      await runMessageHandler(
        rs.fn(async () => undefined),
        message,
        ['data', '{}'],
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.spanContext().traceId).not.toBe(TRACE_ID);
      expect(span.parentSpanContext).toBeUndefined();
    });

    it('should mark the span failed and pass the error on', async () => {
      const failure = new Error('database down');

      await expect(
        runMessageHandler(
          rs.fn(async () => {
            throw failure;
          }),
          message,
          tracedFields,
        ),
      ).rejects.toBe(failure);

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events[0].name).toBe('exception');
    });
  });
});
