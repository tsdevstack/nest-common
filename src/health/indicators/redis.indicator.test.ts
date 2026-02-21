import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { RedisHealthIndicator } from './redis.indicator';
import type { RedisService } from '../../redis/redis.service';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockRedisService: Partial<RedisService>;

  beforeEach(() => {
    mockRedisService = {
      get: rs.fn(),
    };

    indicator = new RedisHealthIndicator(mockRedisService as RedisService);
  });

  describe('check', () => {
    it('should return up status when Redis is available', async () => {
      (mockRedisService.get as ReturnType<typeof rs.fn>).mockResolvedValue(
        null,
      );

      const result = await indicator.check();

      expect(result).toEqual({ status: 'up' });
      expect(mockRedisService.get).toHaveBeenCalledWith('health-check');
    });

    it('should return down status when Redis is unavailable', async () => {
      (mockRedisService.get as ReturnType<typeof rs.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await indicator.check();

      expect(result).toEqual({
        status: 'down',
        details: { error: 'Redis connection failed' },
      });
    });

    it('should handle timeout errors', async () => {
      (mockRedisService.get as ReturnType<typeof rs.fn>).mockRejectedValue(
        new Error('Timeout'),
      );

      const result = await indicator.check();

      expect(result.status).toBe('down');
      expect(result.details?.error).toBe('Redis connection failed');
    });

    it('should not expose sensitive error details', async () => {
      (mockRedisService.get as ReturnType<typeof rs.fn>).mockRejectedValue(
        new Error('Authentication failed with password: secret123'),
      );

      const result = await indicator.check();

      // Should not expose the actual error message
      expect(result.details?.error).toBe('Redis connection failed');
    });
  });
});
