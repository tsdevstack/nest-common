/**
 * Integration test: RedisService survives a Redis outage without a restart.
 *
 * Starts its own Redis container (so stopping it does not disturb the other
 * integration suites that share the `test:redis` container), connects a real
 * RedisService, stops the container for longer than the old retry budget,
 * starts it again and asserts that the same client recovers, fires its
 * `ready` hook, and that the health indicator follows the connection state.
 *
 * Runs with the Docker-backed suite: `npm run test:redis -w @tsdevstack/nest-common`
 * (it needs the `docker` CLI; it is skipped when REDIS_TEST_URL is not set).
 */

import { describe, it, expect, beforeAll, afterAll } from '@rstest/core';
import { execFileSync } from 'node:child_process';
import Redis from 'ioredis';
import { RedisService } from './redis.service';
import { RedisHealthIndicator } from '../health/indicators/redis.indicator';
import type { SecretsService } from '../secrets/secrets.service';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

const CONTAINER = 'nest-common-redis-reconnect-itest';
const HOST = '127.0.0.1';
const PORT = 6398;
const IMAGE = 'redis:7-alpine';

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf-8', stdio: 'pipe' });

const removeContainer = (): void => {
  try {
    docker('rm', '-f', CONTAINER);
  } catch {
    // not running
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(100);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${label}`);
};

/** Polls with a throwaway client until the container answers PING */
const waitForRedis = async (): Promise<void> => {
  await waitFor(
    async () => {
      const probe = new Redis({
        host: HOST,
        port: PORT,
        lazyConnect: true,
        retryStrategy: () => null,
        maxRetriesPerRequest: 0,
      });
      probe.on('error', () => undefined);
      try {
        await probe.connect();
        return (await probe.ping()) === 'PONG';
      } catch {
        return false;
      } finally {
        probe.disconnect();
      }
    },
    20000,
    'Redis container to answer PING',
  );
};

if (!REDIS_TEST_URL) {
  describe('RedisService reconnect (integration)', () => {
    it('skipped — run npm run test:redis', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('RedisService reconnect (integration)', () => {
    let service: RedisService;
    let indicator: RedisHealthIndicator;
    let readyEvents = 0;

    beforeAll(async () => {
      removeContainer();
      docker(
        'run',
        '-d',
        '--name',
        CONTAINER,
        '-p',
        `${HOST}:${PORT}:6379`,
        IMAGE,
      );
      await waitForRedis();

      const secrets: Record<string, string> = {
        REDIS_HOST: HOST,
        REDIS_PORT: String(PORT),
        REDIS_PASSWORD: '',
        REDIS_TLS: 'false',
      };
      service = new RedisService({
        get: (key: string) => Promise.resolve(secrets[key] ?? ''),
      } as unknown as SecretsService);
      service.onReady(() => {
        readyEvents += 1;
      });
      await service.onModuleInit();
      indicator = new RedisHealthIndicator(service);
    }, 60000);

    afterAll(() => {
      service?.onModuleDestroy();
      removeContainer();
    });

    it('recovers after the container is stopped and started, without a restart', async () => {
      const client = service.getClient();

      // Connected
      await waitFor(() => service.isReady(), 10000, 'initial ready');
      expect(readyEvents).toBe(1);
      expect(await service.set('reconnect-itest', 'before')).toBe(true);
      expect(await indicator.check()).toEqual({ status: 'up' });

      // Outage
      docker('stop', '-t', '1', CONTAINER);
      await waitFor(() => !service.isReady(), 10000, 'connection loss');

      const down = await indicator.check();
      expect(down.status).toBe('down');

      // Commands fail fast while disconnected (offline queue disabled)
      await expect(client.set('reconnect-itest', 'during')).rejects.toThrow();

      // Stay down well past the old budget (3 retries, about 300 ms)
      await sleep(7000);
      expect(client.status).not.toBe('end');
      expect(readyEvents).toBe(1);

      // Recovery: same client, no restart
      docker('start', CONTAINER);
      await waitFor(() => readyEvents >= 2, 30000, 'ready hook after restart');

      expect(service.getClient()).toBe(client);
      expect(service.isReady()).toBe(true);
      expect(await service.set('reconnect-itest', 'after')).toBe(true);
      expect(await service.get('reconnect-itest')).toBe('after');
      expect(await indicator.check()).toEqual({ status: 'up' });
    }, 90000);
  });
}
