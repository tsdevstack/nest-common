/**
 * Integration test — runs against a real Redis.
 *
 * This is the highest-risk contract in the Redis changes. The guard does:
 *
 *   const [[, current]] = await redis.multi().incr(k).expire(k, ttl).exec()
 *
 * If ioredis does not actually return [[err, result], [err, result]], then
 * `current` is undefined, every comparison against maxRequests is false, and
 * the guard silently stops rate limiting — while every mocked unit test still
 * passes. Nothing but a real client can catch that.
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
import { RateLimitGuard } from './rate-limit.guard';
import type { RedisService } from '../redis/redis.service';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('RateLimitGuard (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('RateLimitGuard (integration)', () => {
    let redis: Redis;
    let guard: RateLimitGuard;
    let reflector: Reflector;

    const contextForIp = (ip: string): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-real-ip': ip },
            socket: { remoteAddress: ip },
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      }) as unknown as ExecutionContext;

    beforeAll(async () => {
      redis = new Redis(REDIS_TEST_URL);
    });

    afterAll(async () => {
      await redis.quit();
    });

    beforeEach(async () => {
      const keys = await redis.keys('rate_limit:*');
      if (keys.length > 0) await redis.del(...keys);

      reflector = new Reflector();
      guard = new RateLimitGuard(
        { getClient: () => redis } as unknown as RedisService,
        reflector,
      );
    });

    describe('MULTI reply contract', () => {
      it('should return [[err, result], [err, result]] from exec()', async () => {
        const key = 'rate_limit:contract-probe';
        const result = await redis.multi().incr(key).expire(key, 60).exec();

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result![0][0]).toBeNull();
        expect(result![0][1]).toBe(1);
        await redis.del(key);
      });
    });

    describe('Counting', () => {
      it('should increment across successive requests', async () => {
        rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
          maxRequests: 5,
          windowMs: 60000,
        });

        await guard.canActivate(contextForIp('10.0.0.1'));
        await guard.canActivate(contextForIp('10.0.0.1'));

        const [key] = await redis.keys('rate_limit:*');
        expect(await redis.get(key)).toBe('2');
      });

      it('should throw 429 once the limit is passed', async () => {
        rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
          maxRequests: 2,
          windowMs: 60000,
        });

        await guard.canActivate(contextForIp('10.0.0.2'));
        await guard.canActivate(contextForIp('10.0.0.2'));

        await expect(
          guard.canActivate(contextForIp('10.0.0.2')),
        ).rejects.toThrow(HttpException);
      });

      it('should count separate clients independently', async () => {
        rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
          maxRequests: 2,
          windowMs: 60000,
        });

        await guard.canActivate(contextForIp('10.0.0.3'));
        await guard.canActivate(contextForIp('10.0.0.4'));

        expect(await redis.keys('rate_limit:*')).toHaveLength(2);
      });
    });

    describe('TTL', () => {
      it('should always leave a TTL on the key', async () => {
        rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
          maxRequests: 10,
          windowMs: 60000,
        });

        await guard.canActivate(contextForIp('10.0.0.5'));
        const [key] = await redis.keys('rate_limit:*');

        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      it('should still have a TTL after later requests — no permanent key', async () => {
        rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
          maxRequests: 10,
          windowMs: 60000,
        });

        await guard.canActivate(contextForIp('10.0.0.6'));
        await guard.canActivate(contextForIp('10.0.0.6'));
        await guard.canActivate(contextForIp('10.0.0.6'));

        const [key] = await redis.keys('rate_limit:*');
        expect(await redis.ttl(key)).toBeGreaterThan(0);
      });
    });
  });
}
