import { describe, it, expect } from '@rstest/core';
import { markRequestLoggedError } from './mark-request-logged-error';
import { isRequestLoggedError } from './is-request-logged-error';

describe('markRequestLoggedError', () => {
  describe('Standard use cases', () => {
    it('should mark an error as logged', () => {
      const error = new Error('boom');
      markRequestLoggedError(error);
      expect(isRequestLoggedError(error)).toBe(true);
    });

    it('should not change what the error serializes to', () => {
      const error = Object.assign(new Error('boom'), { code: 'E1' });
      const before = JSON.stringify(error);
      markRequestLoggedError(error);
      expect(JSON.stringify(error)).toBe(before);
      expect(Object.keys(error)).toEqual(['code']);
    });
  });

  describe('Edge cases', () => {
    it('should ignore values that cannot carry a property', () => {
      expect(() => markRequestLoggedError('boom')).not.toThrow();
      expect(() => markRequestLoggedError(null)).not.toThrow();
      expect(() => markRequestLoggedError(undefined)).not.toThrow();
    });

    it('should leave a frozen error unmarked without throwing', () => {
      const error = Object.freeze(new Error('frozen'));
      expect(() => markRequestLoggedError(error)).not.toThrow();
      expect(isRequestLoggedError(error)).toBe(false);
    });

    it('should not throw when the same error is marked twice', () => {
      const error = new Error('twice');
      markRequestLoggedError(error);
      expect(() => markRequestLoggedError(error)).not.toThrow();
    });
  });
});
