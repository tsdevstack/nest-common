/**
 * Marks an error the request log already logged (with its request), so the
 * Nest logger adapter can skip Nest's exception handler logging it again.
 * A symbol property: never serialized, never in the way of the error's own
 * fields.
 */
export const REQUEST_LOGGED_ERROR = Symbol.for('tsdevstack.requestLoggedError');

/**
 * Nest's exception handler (BaseExceptionFilter) logs unknown errors under
 * this context
 */
export const NEST_EXCEPTIONS_HANDLER_CONTEXT = 'ExceptionsHandler';

/** Stack trace shape, as Nest's ConsoleLogger recognizes it */
export const STACK_TRACE_PATTERN = /^(.)+\n\s+at .+:\d+:\d+/;

/**
 * Cloud Logging severity for each pino level: GCP reads `severity` from a
 * JSON line, and the console colors and filters lines by it
 */
export const GCP_SEVERITY_BY_PINO_LEVEL: Readonly<Record<string, string>> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/** Fields Cloud Logging reads to link a line to its trace and span */
export const GCP_LOG_TRACE_FIELD = 'logging.googleapis.com/trace';
export const GCP_LOG_SPAN_ID_FIELD = 'logging.googleapis.com/spanId';
export const GCP_LOG_TRACE_SAMPLED_FIELD =
  'logging.googleapis.com/trace_sampled';
