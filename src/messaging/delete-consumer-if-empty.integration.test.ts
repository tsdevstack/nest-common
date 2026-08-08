/**
 * Integration test — runs against a real Redis.
 *
 * Verifies the 6-argument filtered form of XPENDING
 * (key, group, start, end, count, consumer) actually works. A mock accepts
 * any argument list, so a wrong signature here would silently make shutdown
 * cleanup a no-op — or worse, report "no pending" for a consumer that has
 * some, and drop its messages via DELCONSUMER.
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
import { deleteConsumerIfEmpty } from './delete-consumer-if-empty';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('deleteConsumerIfEmpty (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('deleteConsumerIfEmpty (integration)', () => {
    let redis: Redis;
    const logger = new Logger('delete-consumer-integration');
    const stream = 'itest:delcons:stream';
    const group = 'itest:delcons:group';

    const consumersInGroup = async (): Promise<string[]> => {
      const info = (await redis.xinfo(
        'CONSUMERS',
        stream,
        group,
      )) as unknown[][];
      return info.map((entry) => String(entry[entry.indexOf('name') + 1]));
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

    it('should delete a consumer with an empty pending list', async () => {
      await redis.xreadgroup(
        'GROUP',
        group,
        'clean',
        'COUNT',
        1,
        'STREAMS',
        stream,
        '>',
      );

      const deleted = await deleteConsumerIfEmpty(
        redis,
        stream,
        group,
        'clean',
        logger,
      );

      expect(deleted).toBe(true);
      expect(await consumersInGroup()).not.toContain('clean');
    });

    it('should refuse to delete a consumer with pending messages', async () => {
      await redis.xadd(stream, '*', 'data', '{"a":1}');
      await redis.xreadgroup(
        'GROUP',
        group,
        'busy',
        'COUNT',
        10,
        'STREAMS',
        stream,
        '>',
      );

      const deleted = await deleteConsumerIfEmpty(
        redis,
        stream,
        group,
        'busy',
        logger,
      );

      expect(deleted).toBe(false);
      expect(await consumersInGroup()).toContain('busy');
    });

    it('should not drop unacked messages when it refuses', async () => {
      await redis.xadd(stream, '*', 'data', '{"keep":"me"}');
      await redis.xreadgroup(
        'GROUP',
        group,
        'busy',
        'COUNT',
        10,
        'STREAMS',
        stream,
        '>',
      );

      await deleteConsumerIfEmpty(redis, stream, group, 'busy', logger);

      // The entry must still be pending and therefore still reclaimable
      const pending = (await redis.xpending(
        stream,
        group,
        '-',
        '+',
        10,
      )) as unknown[];
      expect(pending).toHaveLength(1);
    });

    it('should become deletable after the pending entry is acked', async () => {
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

      expect(
        await deleteConsumerIfEmpty(redis, stream, group, 'worker', logger),
      ).toBe(false);

      await redis.xack(stream, group, id as string);

      expect(
        await deleteConsumerIfEmpty(redis, stream, group, 'worker', logger),
      ).toBe(true);
    });
  });
}
