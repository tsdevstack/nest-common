/**
 * Integration test — runs against a real Redis.
 *
 * Unit tests mock ioredis, so they prove the decision logic but not that
 * XINFO CONSUMERS actually replies in the shape the parser expects. Redis 7
 * returns an extra `inactive` field, and a client that returned objects
 * instead of flat arrays would make the parser silently return null for every
 * consumer — the reaper would no-op and the leak would be back, with green
 * unit tests.
 *
 * Run with: REDIS_TEST_URL=redis://127.0.0.1:6399 npm run test -w @tsdevstack/nest-common
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@rstest/core';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { reapIdleConsumers } from './reap-idle-consumers';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('reapIdleConsumers (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('reapIdleConsumers (integration)', () => {
    let redis: Redis;
    const logger = new Logger('reap-integration');
    const stream = 'itest:reap:stream';
    const group = 'itest:reap:group';

    const consumersInGroup = async (): Promise<string[]> => {
      const info = (await redis.xinfo(
        'CONSUMERS',
        stream,
        group,
      )) as unknown[][];
      return info.map((entry) => {
        const idx = entry.indexOf('name');
        return String(entry[idx + 1]);
      });
    };

    beforeAll(async () => {
      redis = new Redis(REDIS_TEST_URL);
    });

    afterAll(async () => {
      await redis.quit();
    });

    beforeEach(async () => {
      await redis.del(stream);
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    });

    it('should parse a real XINFO CONSUMERS reply and delete an empty consumer', async () => {
      // XREADGROUP registers the consumer even when there is nothing to read
      await redis.xreadgroup(
        'GROUP',
        group,
        'dead-one',
        'COUNT',
        1,
        'STREAMS',
        stream,
        '>',
      );
      expect(await consumersInGroup()).toContain('dead-one');

      await reapIdleConsumers(redis, stream, group, 'self', logger, 0);

      expect(await consumersInGroup()).not.toContain('dead-one');
    });

    it('should not delete a consumer holding unacked messages', async () => {
      await redis.xadd(stream, '*', 'data', '{"a":1}');
      // Reading without acking leaves the entry in this consumer's PEL
      await redis.xreadgroup(
        'GROUP',
        group,
        'busy-one',
        'COUNT',
        10,
        'STREAMS',
        stream,
        '>',
      );

      await reapIdleConsumers(redis, stream, group, 'self', logger, 0);

      expect(await consumersInGroup()).toContain('busy-one');
    });

    it('should delete the consumer once its pending entries are acked', async () => {
      const id = await redis.xadd(stream, '*', 'data', '{"a":1}');
      await redis.xreadgroup(
        'GROUP',
        group,
        'worker',
        'COUNT',
        10,
        'STREAMS',
        stream,
        '>',
      );

      await reapIdleConsumers(redis, stream, group, 'self', logger, 0);
      expect(await consumersInGroup()).toContain('worker');

      await redis.xack(stream, group, id as string);
      await reapIdleConsumers(redis, stream, group, 'self', logger, 0);
      expect(await consumersInGroup()).not.toContain('worker');
    });

    it('should never delete itself', async () => {
      await redis.xreadgroup(
        'GROUP',
        group,
        'self',
        'COUNT',
        1,
        'STREAMS',
        stream,
        '>',
      );

      await reapIdleConsumers(redis, stream, group, 'self', logger, 0);

      expect(await consumersInGroup()).toContain('self');
    });

    it('should respect the idle threshold', async () => {
      await redis.xreadgroup(
        'GROUP',
        group,
        'fresh',
        'COUNT',
        1,
        'STREAMS',
        stream,
        '>',
      );

      // Just-created consumer is ~0ms idle, far below this threshold
      await reapIdleConsumers(redis, stream, group, 'self', logger, 600_000);

      expect(await consumersInGroup()).toContain('fresh');
    });

    it('should reap several dead consumers in one sweep', async () => {
      for (const name of ['d1', 'd2', 'd3']) {
        await redis.xreadgroup(
          'GROUP',
          group,
          name,
          'COUNT',
          1,
          'STREAMS',
          stream,
          '>',
        );
      }
      expect(await consumersInGroup()).toHaveLength(3);

      await reapIdleConsumers(redis, stream, group, 'self', logger, 0);

      expect(await consumersInGroup()).toHaveLength(0);
    });
  });
}
