import { TraceFlags, type SpanContext } from '@opentelemetry/api';
import { toXrayTraceId } from '@tsdevstack/telemetry';
import {
  GCP_LOG_SPAN_ID_FIELD,
  GCP_LOG_TRACE_FIELD,
  GCP_LOG_TRACE_SAMPLED_FIELD,
} from './logging.constants';

/**
 * The trace fields of a log line: trace_id and span_id everywhere (so
 * `infra:logs --grep <trace id>` finds a request's lines), plus what each
 * cloud's console reads: on GCP the fields that link the line to Cloud
 * Trace, on AWS the trace ID in X-Ray's form, as its console shows it.
 */
export function buildTraceLogFields(
  spanContext: SpanContext,
  provider: string | undefined,
  gcpProjectId: string | undefined,
): Record<string, string | boolean> {
  const { traceId, spanId, traceFlags } = spanContext;
  const fields: Record<string, string | boolean> = {
    trace_id: traceId,
    span_id: spanId,
  };

  if (provider === 'gcp' && gcpProjectId) {
    fields[GCP_LOG_TRACE_FIELD] = `projects/${gcpProjectId}/traces/${traceId}`;
    fields[GCP_LOG_SPAN_ID_FIELD] = spanId;
    fields[GCP_LOG_TRACE_SAMPLED_FIELD] =
      (traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
  } else if (provider === 'aws') {
    const xrayTraceId = toXrayTraceId(traceId);
    if (xrayTraceId) {
      fields.xray_trace_id = xrayTraceId;
    }
  }

  return fields;
}
