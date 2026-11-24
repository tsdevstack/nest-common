import { describe, it, expect } from '@rstest/core';
import { buildCronLockKey } from './build-cron-lock-key';

describe('buildCronLockKey', () => {
  describe('Standard use cases', () => {
    it('should build cron:{service}:{name}', () => {
      expect(buildCronLockKey('auth-service', 'usage-report')).toBe(
        'cron:auth-service:usage-report',
      );
    });

    it('should keep two jobs of one service apart', () => {
      expect(buildCronLockKey('auth-service', 'a')).not.toBe(
        buildCronLockKey('auth-service', 'b'),
      );
    });

    it('should keep the same job of two services apart', () => {
      expect(buildCronLockKey('auth-service', 'report')).not.toBe(
        buildCronLockKey('bff-service', 'report'),
      );
    });
  });
});
