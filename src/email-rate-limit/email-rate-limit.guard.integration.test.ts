/**
 * Integration test — runs against a real Redis.
 *
 * Confirms end to end that hashing the address did not change what rate
 * limiting actually does: the same address must keep hitting the same
 * counter, different addresses must not share one, and no plaintext address
 * may appear in the keyspace.
 *
 * Run with: REDIS_TEST_URL=redis://127.0.0.1:6399 npm run test -w @tsdevstack/nest-common
 */

import {
  describe,
  it,
  expect,
  rs,
  beforeAll,
  afterAll,
  beforeEach,
} from '@rstest/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { EmailRateLimitGuard } from './email-rate-limit.guard';
import type { RedisService } from '../redis/redis.service';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('EmailRateLimitGuard (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('EmailRateLimitGuard (integration)', () => {
    let redis: Redis;
    let guard: EmailRateLimitGuard;
    let reflector: Reflector;

    const contextFor = (body: Record<string, unknown>): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ body }) }),
        getHandler: () => ({}),
      }) as unknown as ExecutionContext;

    beforeAll(async () => {
      redis = new Redis(REDIS_TEST_URL);
    });

    afterAll(async () => {
      await redis.quit();
    });

    beforeEach(async () => {
      const keys = await redis.keys('email_rate_limit:*');
      if (keys.length > 0) await redis.del(...keys);

      reflector = new Reflector();
      guard = new EmailRateLimitGuard(
        { getClient: () => redis } as unknown as RedisService,
        reflector,
      );
      rs.spyOn(reflector, 'get').mockReturnValue({
        maxRequests: 3,
        windowMs: 60000,
      });
    });

    it('should keep no plaintext address anywhere in the keyspace', async () => {
      await guard.canActivate(contextFor({ email: 'alice@example.com' }));

      const keys = await redis.keys('email_rate_limit:*');
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toContain('alice');
      expect(keys[0]).not.toContain('@');
      expect(keys[0]).toMatch(/^email_rate_limit:[0-9a-f]{32}:\d+$/);
    });

    it('should count casing variants as the same address', async () => {
      await guard.canActivate(contextFor({ email: 'alice@example.com' }));
      await guard.canActivate(contextFor({ email: '  Alice@Example.COM ' }));

      const keys = await redis.keys('email_rate_limit:*');
      expect(keys).toHaveLength(1);
      expect(await redis.get(keys[0])).toBe('2');
    });

    it('should keep distinct addresses on distinct counters', async () => {
      await guard.canActivate(contextFor({ email: 'alice@example.com' }));
      await guard.canActivate(contextFor({ email: 'bob@example.com' }));

      expect(await redis.keys('email_rate_limit:*')).toHaveLength(2);
    });

    it('should still enforce the limit', async () => {
      await guard.canActivate(contextFor({ email: 'carol@example.com' }));
      await guard.canActivate(contextFor({ email: 'carol@example.com' }));
      await guard.canActivate(contextFor({ email: 'carol@example.com' }));

      await expect(
        guard.canActivate(contextFor({ email: 'carol@example.com' })),
      ).rejects.toThrow(HttpException);
    });

    it('should leave a TTL so counters cannot accumulate', async () => {
      await guard.canActivate(contextFor({ email: 'dave@example.com' }));

      const [key] = await redis.keys('email_rate_limit:*');
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });
}
