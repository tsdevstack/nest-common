import { describe, it, expect } from '@rstest/core';
import { TraceFlags } from '@opentelemetry/api';
import { buildTraceLogFields } from './build-trace-log-fields';

const SPAN = {
  traceId: '5759e988bd862e3fe1be46a994272793',
  spanId: '53995c3f42cd8ad8',
  traceFlags: TraceFlags.SAMPLED,
};

describe('buildTraceLogFields', () => {
  describe('Standard use cases', () => {
    it('should give the trace and span IDs locally', () => {
      expect(buildTraceLogFields(SPAN, 'local', undefined)).toEqual({
        trace_id: SPAN.traceId,
        span_id: SPAN.spanId,
      });
    });

    it('should add the fields that link a line to Cloud Trace on GCP', () => {
      expect(buildTraceLogFields(SPAN, 'gcp', 'shop-dev')).toEqual({
        trace_id: SPAN.traceId,
        span_id: SPAN.spanId,
        'logging.googleapis.com/trace': `projects/shop-dev/traces/${SPAN.traceId}`,
        'logging.googleapis.com/spanId': SPAN.spanId,
        'logging.googleapis.com/trace_sampled': true,
      });
    });

    it("should add the trace ID in X-Ray's form on AWS", () => {
      expect(buildTraceLogFields(SPAN, 'aws', undefined)).toEqual({
        trace_id: SPAN.traceId,
        span_id: SPAN.spanId,
        xray_trace_id: '1-5759e988-bd862e3fe1be46a994272793',
      });
    });
  });

  describe('Edge cases', () => {
    it('should say when the trace was not sampled', () => {
      const fields = buildTraceLogFields(
        { ...SPAN, traceFlags: TraceFlags.NONE },
        'gcp',
        'shop-dev',
      );
      expect(fields['logging.googleapis.com/trace_sampled']).toBe(false);
    });

    it('should leave the GCP fields out without a project', () => {
      expect(buildTraceLogFields(SPAN, 'gcp', undefined)).toEqual({
        trace_id: SPAN.traceId,
        span_id: SPAN.spanId,
      });
    });
  });
});
