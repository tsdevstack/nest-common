import { context, propagation } from '@opentelemetry/api';

/**
 * The active trace as stream entry fields ([traceparent, value, ...]), so
 * the subscriber's handler runs in the publisher's trace. Empty outside a
 * trace.
 */
export function buildTraceFields(): string[] {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  return Object.entries(carrier).flat();
}
