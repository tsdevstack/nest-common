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
