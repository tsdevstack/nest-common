import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { RedisHealthIndicator } from './redis.indicator';
import type { RedisService } from '../../redis/redis.service';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockClient: { status: string; ping: ReturnType<typeof rs.fn> };
  let mockRedisService: { getClient: ReturnType<typeof rs.fn> };

  beforeEach(() => {
    mockClient = {
      status: 'ready',
      ping: rs.fn().mockResolvedValue('PONG'),
    };
    mockRedisService = {
      getClient: rs.fn().mockReturnValue(mockClient),
    };

    indicator = new RedisHealthIndicator(
      mockRedisService as unknown as RedisService,
    );
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Standard use cases', () => {
    it('should return up when the client is ready and PING succeeds', async () => {
      const result = await indicator.check();

      expect(result).toEqual({ status: 'up' });
      expect(mockClient.ping).toHaveBeenCalledTimes(1);
    });

    it('should return down when PING fails', async () => {
      mockClient.ping.mockRejectedValue(new Error('Connection refused'));

      const result = await indicator.check();

      expect(result).toEqual({
        status: 'down',
        details: { error: 'Redis connection failed' },
      });
    });
  });

  describe('Connection not ready', () => {
    it.each(['connecting', 'connect', 'reconnecting', 'close', 'end', 'wait'])(
      'should return down without pinging when status is %s',
      async (status) => {
        mockClient.status = status;

        const result = await indicator.check();

        expect(result).toEqual({
          status: 'down',
          details: {
            error: 'Redis connection not ready',
            connection: status,
          },
        });
        expect(mockClient.ping).not.toHaveBeenCalled();
      },
    );

    it('should return down when the client was never created', async () => {
      mockRedisService.getClient.mockReturnValue(undefined);

      const result = await indicator.check();

      expect(result).toEqual({
        status: 'down',
        details: {
          error: 'Redis connection not ready',
          connection: 'uninitialized',
        },
      });
    });
  });

  describe('Edge cases', () => {
    it('should return down when PING does not answer in time', async () => {
      rs.useFakeTimers();
      mockClient.ping.mockReturnValue(new Promise(() => undefined));

      const pending = indicator.check();
      await rs.advanceTimersByTimeAsync(2000);

      await expect(pending).resolves.toEqual({
        status: 'down',
        details: { error: 'Redis connection failed' },
      });
    });

    it('should not expose sensitive error details', async () => {
      mockClient.ping.mockRejectedValue(
        new Error('Authentication failed with password: secret123'),
      );

      const result = await indicator.check();

      expect(result.details?.error).toBe('Redis connection failed');
    });
  });
});
