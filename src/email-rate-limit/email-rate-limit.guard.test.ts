import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { EmailRateLimitGuard } from './email-rate-limit.guard';
import type { RedisService } from '../redis/redis.service';

describe('EmailRateLimitGuard', () => {
  let guard: EmailRateLimitGuard;
  let reflector: Reflector;
  let mockRedisService: Partial<RedisService>;
  let mockRedisClient: {
    incr: ReturnType<typeof rs.fn>;
    expire: ReturnType<typeof rs.fn>;
    multi: ReturnType<typeof rs.fn>;
  };

  const createMockContext = (
    body: Record<string, unknown> = {},
  ): ExecutionContext => {
    const request = { body };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    rs.clearAllMocks();

    mockRedisClient = {
      incr: rs.fn().mockResolvedValue(1),
      expire: rs.fn().mockResolvedValue(1),
      multi: rs.fn(),
    };

    // The guard batches INCR + EXPIRE in a MULTI — see rate-limit.guard.test.ts
    mockRedisClient.multi.mockImplementation(() => {
      let incrResult: Promise<number> = Promise.resolve(0);
      const chain = {
        incr: (key: string) => {
          incrResult = mockRedisClient.incr(key) as Promise<number>;
          return chain;
        },
        expire: (key: string, ttl: number) => {
          mockRedisClient.expire(key, ttl);
          return chain;
        },
        exec: async () => [
          [null, await incrResult],
          [null, 1],
        ],
      };
      return chain;
    });

    mockRedisService = {
      getClient: rs.fn().mockReturnValue(mockRedisClient),
    };

    reflector = new Reflector();
    guard = new EmailRateLimitGuard(
      mockRedisService as RedisService,
      reflector,
    );
  });

  describe('No decorator', () => {
    it('should allow request when no decorator applied', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue(undefined);

      const result = await guard.canActivate(createMockContext());
      expect(result).toBe(true);
    });
  });

  describe('Email extraction', () => {
    it('should skip rate limiting when no email in body', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });

      const result = await guard.canActivate(createMockContext({}));
      expect(result).toBe(true);
      expect(mockRedisClient.incr).not.toHaveBeenCalled();
    });

    it('should skip when email is not a string', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });

      const result = await guard.canActivate(createMockContext({ email: 123 }));
      expect(result).toBe(true);
    });

    it('should never put the plaintext address in the key', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });

      await guard.canActivate(createMockContext({ email: 'user@example.com' }));

      const key = mockRedisClient.incr.mock.calls[0][0] as string;
      expect(key).not.toContain('user@example.com');
      expect(key).not.toContain('@');
      expect(key).toMatch(/^email_rate_limit:[0-9a-f]{32}:\d+$/);
    });

    it('should map casing and whitespace variants to the same counter', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });

      await guard.canActivate(
        createMockContext({ email: '  User@Example.COM  ' }),
      );
      await guard.canActivate(createMockContext({ email: 'user@example.com' }));

      const [firstKey] = mockRedisClient.incr.mock.calls[0] as [string];
      const [secondKey] = mockRedisClient.incr.mock.calls[1] as [string];
      expect(firstKey).toBe(secondKey);
    });

    it('should map different addresses to different counters', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });

      await guard.canActivate(createMockContext({ email: 'a@example.com' }));
      await guard.canActivate(createMockContext({ email: 'b@example.com' }));

      const [firstKey] = mockRedisClient.incr.mock.calls[0] as [string];
      const [secondKey] = mockRedisClient.incr.mock.calls[1] as [string];
      expect(firstKey).not.toBe(secondKey);
    });

    it('should use custom emailField', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({
        maxRequests: 3,
        emailField: 'userEmail',
      });

      await guard.canActivate(
        createMockContext({ userEmail: 'test@test.com' }),
      );

      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        expect.stringMatching(/^email_rate_limit:[0-9a-f]{32}:\d+$/),
      );
    });
  });

  describe('Rate limiting', () => {
    it('should allow request under the limit', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 5 });
      mockRedisClient.incr.mockResolvedValue(3);

      const result = await guard.canActivate(
        createMockContext({ email: 'user@test.com' }),
      );
      expect(result).toBe(true);
    });

    it('should set expiry on first request', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({
        maxRequests: 5,
        windowMs: 60000,
      });
      mockRedisClient.incr.mockResolvedValue(1);

      await guard.canActivate(createMockContext({ email: 'user@test.com' }));

      expect(mockRedisClient.expire).toHaveBeenCalled();
    });

    it('should throw 429 when limit exceeded', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });
      mockRedisClient.incr.mockResolvedValue(4);

      await expect(
        guard.canActivate(createMockContext({ email: 'user@test.com' })),
      ).rejects.toThrow(HttpException);

      try {
        await guard.canActivate(createMockContext({ email: 'user@test.com' }));
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    });

    it('should use custom message', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({
        maxRequests: 1,
        message: 'Email limit reached',
      });
      mockRedisClient.incr.mockResolvedValue(2);

      try {
        await guard.canActivate(createMockContext({ email: 'user@test.com' }));
      } catch (e) {
        const response = (e as HttpException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.message).toBe('Email limit reached');
      }
    });
  });

  describe('Fail open', () => {
    it('should allow request when Redis fails', async () => {
      rs.spyOn(reflector, 'get').mockReturnValue({ maxRequests: 3 });
      mockRedisClient.incr.mockRejectedValue(new Error('Redis down'));

      const result = await guard.canActivate(
        createMockContext({ email: 'user@test.com' }),
      );
      expect(result).toBe(true);
    });
  });
});
