import { describe, it, expect } from '@rstest/core';
import { redisRetryStrategy } from './redis-retry-strategy';

describe('redisRetryStrategy', () => {
  describe('Backoff', () => {
    it('should start at 100 ms', () => {
      expect(redisRetryStrategy(1)).toBe(100);
    });

    it('should double on each attempt', () => {
      expect(redisRetryStrategy(2)).toBe(200);
      expect(redisRetryStrategy(3)).toBe(400);
      expect(redisRetryStrategy(6)).toBe(3200);
    });

    it('should cap the delay at 5 seconds', () => {
      expect(redisRetryStrategy(7)).toBe(5000);
      expect(redisRetryStrategy(50)).toBe(5000);
    });
  });

  describe('Never gives up', () => {
    it.each([4, 10, 100, 1000, 100000])(
      'should return a number for attempt %i',
      (times) => {
        const delay = redisRetryStrategy(times);
        expect(typeof delay).toBe('number');
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeLessThanOrEqual(5000);
      },
    );
  });

  describe('Edge cases', () => {
    it('should treat attempt 0 like the first attempt', () => {
      expect(redisRetryStrategy(0)).toBe(100);
    });
  });
});
