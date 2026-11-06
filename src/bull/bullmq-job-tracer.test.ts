import {
  describe,
  it,
  expect,
  rs,
  beforeAll,
  afterAll,
  beforeEach,
} from '@rstest/core';
import { ROOT_CONTEXT, context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { SpanKind, type Span, type Tracer } from 'bullmq';
import { BullMqJobTracer } from './bullmq-job-tracer';

const PARENT = trace.wrapSpanContext({
  traceId: '5759e988bd862e3fe1be46a994272793',
  spanId: '7d0e9b68a33bca06',
  traceFlags: 1,
});

describe('BullMqJobTracer', () => {
  const contextManager = new AsyncLocalStorageContextManager();
  const delegated = { end: rs.fn() } as unknown as Span;
  const inner: Tracer = { startSpan: rs.fn().mockReturnValue(delegated) };
  const tracer = new BullMqJobTracer(inner);

  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    context.disable();
  });

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should not record housekeeping outside a trace', () => {
      const span = tracer.startSpan('moveStalledJobsToWait notifications', {
        kind: SpanKind.INTERNAL,
      });

      expect(inner.startSpan).not.toHaveBeenCalled();
      expect(span).not.toBe(delegated);
      // A span that records nothing and starts no trace
      expect(() => span.end()).not.toThrow();
    });

    it('should keep a job queued outside a trace', () => {
      const span = tracer.startSpan('add notifications.confirmation-email', {
        kind: SpanKind.PRODUCER,
      });

      expect(span).toBe(delegated);
    });

    it('should keep a job processed outside a trace', () => {
      const span = tracer.startSpan('process notifications', {
        kind: SpanKind.CONSUMER,
      });

      expect(span).toBe(delegated);
    });

    it('should keep internal spans inside an active trace', () => {
      const span = context.with(trace.setSpan(ROOT_CONTEXT, PARENT), () =>
        tracer.startSpan('complete notifications', {
          kind: SpanKind.INTERNAL,
        }),
      );

      expect(span).toBe(delegated);
    });
  });

  describe('Edge cases', () => {
    it('should keep internal spans whose given context has a parent', () => {
      const parentContext = trace.setSpan(ROOT_CONTEXT, PARENT);

      const span = tracer.startSpan(
        'complete notifications',
        { kind: SpanKind.INTERNAL },
        parentContext,
      );

      expect(span).toBe(delegated);
      expect(inner.startSpan).toHaveBeenCalledWith(
        'complete notifications',
        { kind: SpanKind.INTERNAL },
        parentContext,
      );
    });
  });
});
