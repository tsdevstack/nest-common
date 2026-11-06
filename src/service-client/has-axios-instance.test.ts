import { describe, it, expect } from '@rstest/core';
import { hasAxiosInstance } from './has-axios-instance';

describe('hasAxiosInstance', () => {
  describe('Standard use cases', () => {
    it("should recognize a generated client's axios instance", () => {
      // axios.create() returns a callable function with properties
      const instance = Object.assign(() => undefined, {
        interceptors: { request: { use: () => 0 } },
      });
      expect(hasAxiosInstance({ instance, v1: {} })).toBe(true);
    });

    it('should accept an instance that is a plain object', () => {
      const client = {
        instance: { interceptors: { request: { use: () => 0 } } },
      };
      expect(hasAxiosInstance(client)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should reject anything else', () => {
      expect(hasAxiosInstance(undefined)).toBe(false);
      expect(hasAxiosInstance(null)).toBe(false);
      expect(hasAxiosInstance({})).toBe(false);
      expect(hasAxiosInstance({ instance: {} })).toBe(false);
      expect(
        hasAxiosInstance({ instance: { interceptors: { request: {} } } }),
      ).toBe(false);
    });
  });
});
