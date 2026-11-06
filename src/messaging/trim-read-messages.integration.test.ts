/**
 * Integration test — runs against a real Redis.
 *
 * Verifies that trimming deletes only entries every subscriber group
 * finished: XINFO GROUPS, the XPENDING summary and XTRIM MINID behave as the
 * code expects (Redis 6.2 or later).
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
import { trimReadMessages } from './trim-read-messages';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('trimReadMessages (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('trimReadMessages (integration)', () => {
    let redis: Redis;
    const logger = new Logger('trim-integration');
    const stream = 'itest:trim:stream';

    beforeAll(async () => {
      redis = new Redis(REDIS_TEST_URL);
    });

    afterAll(async () => {
      await redis.quit();
    });

    beforeEach(async () => {
      await redis.del(stream);
    });

    /** Publish n entries with explicit IDs 1-0 .. n-0 */
    const publish = async (n: number): Promise<void> => {
      for (let i = 1; i <= n; i++) {
        await redis.xadd(stream, `${i}-0`, 'data', `{"n":${i}}`);
      }
    };

    /** Deliver up to `count` new entries to a consumer of `group` */
    const read = async (group: string, count: number): Promise<string[]> => {
      const result = (await redis.xreadgroup(
        'GROUP',
        group,
        'c1',
        'COUNT',
        count,
        'STREAMS',
        stream,
        '>',
      )) as Array<[string, Array<[string, string[]]>]> | null;
      return (result?.[0]?.[1] ?? []).map(([id]) => id);
    };

    const remaining = async (): Promise<string[]> =>
      (await redis.xrange(stream, '-', '+')).map(([id]) => id);

    it('should keep unread and unconfirmed entries, and delete confirmed ones', async () => {
      // Exact trims (no ~) are only possible with XTRIM's exact form; the
      // code uses ~, which deletes whole internal nodes. Lowering the node
      // size makes ~ trim at every entry here.
      await redis.config('SET', 'stream-node-max-entries', '1');
      try {
        await publish(6);
        await redis.xgroup('CREATE', stream, 'g1', '0');
        const ids = await read('g1', 4); // 1..4 delivered
        await redis.xack(stream, 'g1', ids[0], ids[1]); // 1, 2 confirmed

        await trimReadMessages(redis, stream, logger);

        // 3 and 4 are pending, 5 and 6 unread
        expect(await remaining()).toEqual(['3-0', '4-0', '5-0', '6-0']);
      } finally {
        await redis.config('SET', 'stream-node-max-entries', '100');
      }
    });

    it('should keep everything a group behind still needs', async () => {
      await redis.config('SET', 'stream-node-max-entries', '1');
      try {
        await publish(5);
        await redis.xgroup('CREATE', stream, 'ahead', '0');
        await redis.xgroup('CREATE', stream, 'behind', '0');
        await redis.xack(stream, 'ahead', ...(await read('ahead', 5)));
        await redis.xack(stream, 'behind', ...(await read('behind', 2)));

        await trimReadMessages(redis, stream, logger);

        // "behind" confirmed 1 and 2 and was last given 2: 2 onwards stays
        expect(await remaining()).toEqual(['2-0', '3-0', '4-0', '5-0']);
      } finally {
        await redis.config('SET', 'stream-node-max-entries', '100');
      }
    });

    it('should delete nothing while a group has read nothing', async () => {
      await publish(3);
      await redis.xgroup('CREATE', stream, 'g1', '0');
      await redis.xgroup('CREATE', stream, 'new', '0');
      await redis.xack(stream, 'g1', ...(await read('g1', 3)));

      await trimReadMessages(redis, stream, logger);

      expect(await remaining()).toEqual(['1-0', '2-0', '3-0']);
    });
  });
}
