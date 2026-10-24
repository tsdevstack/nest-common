/**
 * Mark Request Logged Error
 *
 * Records on an error that the request log already logged it. Values that
 * cannot carry a property (strings, frozen objects) are left alone; Nest
 * then logs them as before.
 */

import { REQUEST_LOGGED_ERROR } from './logging.constants';

export function markRequestLoggedError(error: unknown): void {
  if (typeof error !== 'object' || error === null) {
    return;
  }
  try {
    Object.defineProperty(error, REQUEST_LOGGED_ERROR, { value: true });
  } catch {
    // Frozen or non-extensible error
  }
}
