import { describe, it, expect } from '@rstest/core';
import { ROOT_CONTEXT } from '@opentelemetry/api';
import { BullMqJobTracer } from './bullmq-job-tracer';
import { createBullMqTelemetry } from './create-bullmq-telemetry';

describe('createBullMqTelemetry', () => {
  describe('Standard use cases', () => {
    it('should trace through the job tracer', () => {
      const telemetry = createBullMqTelemetry();

      expect(telemetry.tracer).toBeInstanceOf(BullMqJobTracer);
    });

    it("should pass the request's trace into the job", () => {
      const telemetry = createBullMqTelemetry();

      // The metadata a job carries from the request to the worker
      expect(typeof telemetry.contextManager.getMetadata(ROOT_CONTEXT)).toBe(
        'string',
      );
    });
  });

  describe('Edge cases', () => {
    it('should leave BullMQ metrics off, as before', () => {
      const telemetry = createBullMqTelemetry();

      expect(telemetry.meter).toBeUndefined();
    });
  });
});
