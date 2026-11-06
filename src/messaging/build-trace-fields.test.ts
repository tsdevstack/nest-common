import { describe, it, expect, beforeAll, afterAll } from '@rstest/core';
import { ROOT_CONTEXT, context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { buildTraceFields } from './build-trace-fields';

describe('buildTraceFields', () => {
  beforeAll(() => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterAll(() => {
    context.disable();
    propagation.disable();
  });

  describe('Standard use cases', () => {
    it('should give the active trace as entry fields', () => {
      const span = trace.wrapSpanContext({
        traceId: '5759e988bd862e3fe1be46a994272793',
        spanId: '7d0e9b68a33bca06',
        traceFlags: 1,
      });

      const fields = context.with(trace.setSpan(ROOT_CONTEXT, span), () =>
        buildTraceFields(),
      );

      expect(fields).toEqual([
        'traceparent',
        '00-5759e988bd862e3fe1be46a994272793-7d0e9b68a33bca06-01',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should give no fields outside a trace', () => {
      expect(buildTraceFields()).toEqual([]);
    });
  });
});
