import { describe, it, expect } from '@rstest/core';
import { isRequestLoggedError } from './is-request-logged-error';
import { markRequestLoggedError } from './mark-request-logged-error';

describe('isRequestLoggedError', () => {
  it('should be false for an error that was not marked', () => {
    expect(isRequestLoggedError(new Error('boom'))).toBe(false);
  });

  it('should be true for a marked error', () => {
    const error = new Error('boom');
    markRequestLoggedError(error);
    expect(isRequestLoggedError(error)).toBe(true);
  });

  it('should be false for values that are not objects', () => {
    expect(isRequestLoggedError('boom')).toBe(false);
    expect(isRequestLoggedError(undefined)).toBe(false);
    expect(isRequestLoggedError(null)).toBe(false);
  });
});
