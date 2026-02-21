import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RateLimitGuard } from './rate-limit.guard';
import type { RedisService } from '../redis/redis.service';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;
  let mockRedisService: Partial<RedisService>;
  let mockRedisClient: {
    incr: ReturnType<typeof rs.fn>;
    expire: ReturnType<typeof rs.fn>;
  };

  const createMockContext = (
    headers: Record<string, string> = {},
    extra: Record<string, unknown> = {},
  ): ExecutionContext => {
    const request = {
      headers,
      socket: { remoteAddress: '127.0.0.1' },
      ...extra,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    rs.clearAllMocks();

    mockRedisClient = {
      incr: rs.fn().mockResolvedValue(1),
      expire: rs.fn().mockResolvedValue(1),
    };

    mockRedisService = {
      getClient: rs.fn().mockReturnValue(mockRedisClient),
    };

    reflector = new Reflector();
    guard = new RateLimitGuard(mockRedisService as RedisService, reflector);
  });

  describe('No rate limit decorator', () => {
    it('should allow request when no decorator applied', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const result = await guard.canActivate(createMockContext());
      expect(result).toBe(true);
    });
  });

  describe('skipIf condition', () => {
    it('should skip rate limiting when skipIf returns true', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        skipIf: () => true,
      });

      const result = await guard.canActivate(createMockContext());
      expect(result).toBe(true);
      expect(mockRedisClient.incr).not.toHaveBeenCalled();
    });
  });

  describe('Rate limiting', () => {
    it('should allow request under the limit', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        windowMs: 60000,
      });
      mockRedisClient.incr.mockResolvedValue(5);

      const result = await guard.canActivate(createMockContext());
      expect(result).toBe(true);
    });

    it('should set expiry on first request in window', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        windowMs: 60000,
      });
      mockRedisClient.incr.mockResolvedValue(1);

      await guard.canActivate(createMockContext());

      expect(mockRedisClient.expire).toHaveBeenCalled();
    });

    it('should not set expiry on subsequent requests', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        windowMs: 60000,
      });
      mockRedisClient.incr.mockResolvedValue(3);

      await guard.canActivate(createMockContext());

      expect(mockRedisClient.expire).not.toHaveBeenCalled();
    });

    it('should throw 429 when limit exceeded', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 5,
        windowMs: 60000,
      });
      mockRedisClient.incr.mockResolvedValue(6);

      await expect(guard.canActivate(createMockContext())).rejects.toThrow(
        HttpException,
      );

      try {
        await guard.canActivate(createMockContext());
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    });

    it('should use custom message when provided', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 1,
        message: 'Slow down!',
      });
      mockRedisClient.incr.mockResolvedValue(2);

      try {
        await guard.canActivate(createMockContext());
      } catch (e) {
        const response = (e as HttpException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.message).toBe('Slow down!');
      }
    });

    it('should attach rateLimit info to request', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
      });
      mockRedisClient.incr.mockResolvedValue(3);

      const context = createMockContext();
      await guard.canActivate(context);

      const request = context.switchToHttp().getRequest() as Record<
        string,
        unknown
      >;
      expect(request.rateLimit).toBeDefined();
      expect((request.rateLimit as { remaining: number }).remaining).toBe(7);
    });
  });

  describe('Key generators', () => {
    it('should use IP by default', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
      });

      await guard.canActivate(
        createMockContext({ 'x-forwarded-for': '10.0.0.1' }),
      );

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringContaining('ip:10.0.0.1'),
      );
    });

    it('should extract IP from x-real-ip', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
      });

      await guard.canActivate(createMockContext({ 'x-real-ip': '10.0.0.2' }));

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringContaining('ip:10.0.0.2'),
      );
    });

    it('should use apiKey generator', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        keyGenerator: 'apiKey',
      });

      await guard.canActivate(createMockContext({ 'x-api-key': 'my-key' }));

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringContaining('api:my-key'),
      );
    });

    it('should throw UnauthorizedException for apiKey without header', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        keyGenerator: 'apiKey',
      });

      await expect(guard.canActivate(createMockContext())).rejects.toThrow(
        'API key required',
      );
    });

    it('should use userId generator', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        keyGenerator: 'userId',
      });

      await guard.canActivate(
        createMockContext({}, { user: { id: 'user-123' } }),
      );

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringContaining('user:user-123'),
      );
    });

    it('should use sub as fallback for userId', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        keyGenerator: 'userId',
      });

      await guard.canActivate(
        createMockContext({}, { user: { sub: 'sub-456' } }),
      );

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringContaining('user:sub-456'),
      );
    });

    it('should throw UnauthorizedException for userId without user', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        keyGenerator: 'userId',
      });

      await expect(guard.canActivate(createMockContext())).rejects.toThrow(
        'User authentication required',
      );
    });

    it('should use custom key generator', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
        customKeyGenerator: () => 'custom-key',
      });

      await guard.canActivate(createMockContext());

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringContaining('custom-key'),
      );
    });
  });

  describe('Fail open', () => {
    it('should allow request when Redis fails', async () => {
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        maxRequests: 10,
      });
      mockRedisClient.incr.mockRejectedValue(new Error('Redis down'));

      const result = await guard.canActivate(createMockContext());
      expect(result).toBe(true);
    });
  });
});
