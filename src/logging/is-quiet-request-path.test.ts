import { describe, it, expect } from '@rstest/core';
import { isQuietRequestPath } from './is-quiet-request-path';

describe('isQuietRequestPath', () => {
  describe('Standard use cases', () => {
    it('should be quiet for metrics scrapes and health probes', () => {
      expect(isQuietRequestPath('/metrics')).toBe(true);
      expect(isQuietRequestPath('/health')).toBe(true);
      expect(isQuietRequestPath('/health/ping')).toBe(true);
      expect(isQuietRequestPath('/health?verbose=1')).toBe(true);
    });

    it('should log everything else', () => {
      expect(isQuietRequestPath('/auth/v1/auth/login')).toBe(false);
      expect(isQuietRequestPath('/offers/v1/plans')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should not match look-alike paths', () => {
      expect(isQuietRequestPath('/healthz')).toBe(false);
      expect(isQuietRequestPath('/metrics-export')).toBe(false);
      expect(isQuietRequestPath('/v1/health')).toBe(false);
      expect(isQuietRequestPath('/x?next=/health')).toBe(false);
    });
  });
});
