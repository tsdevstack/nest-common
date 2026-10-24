/**
 * Get Error Status
 *
 * The HTTP status Nest's exception filter answers an error with. The logging
 * interceptor sees the error before the filter sets the response status (it
 * still reads 200 then), so it derives the status from the error the same
 * way Nest's base filter does.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export function getErrorStatus(error: unknown): number {
  if (error instanceof HttpException) {
    return error.getStatus();
  }

  // http-errors style errors: Nest answers with their own status
  if (typeof error === 'object' && error !== null) {
    const { statusCode, message } = error as {
      statusCode?: unknown;
      message?: unknown;
    };
    if (typeof statusCode === 'number' && message) {
      return statusCode;
    }
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}
