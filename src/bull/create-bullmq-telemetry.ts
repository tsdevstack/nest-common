import type { Context } from '@opentelemetry/api';
import type { Telemetry } from 'bullmq';
import { BullMQOtel } from 'bullmq-otel';
import { BULLMQ_TRACER_NAME } from '../telemetry/telemetry.constants';
import { BullMqJobTracer } from './bullmq-job-tracer';

/**
 * Telemetry for every queue and worker: a job runs in the trace of the
 * request that queued it; the queue's housekeeping is left out
 * (BullMqJobTracer).
 */
export function createBullMqTelemetry(): Telemetry<Context> {
  const otel = new BullMQOtel({ tracerName: BULLMQ_TRACER_NAME });

  return {
    tracer: new BullMqJobTracer(otel.tracer),
    contextManager: otel.contextManager,
  };
}
