/**
 * Is Request Logged Error
 *
 * Whether the request log already logged this error (see
 * markRequestLoggedError).
 */

import { REQUEST_LOGGED_ERROR } from './logging.constants';

export function isRequestLoggedError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[REQUEST_LOGGED_ERROR] === true
  );
}
