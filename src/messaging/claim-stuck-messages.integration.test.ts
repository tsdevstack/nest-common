/**
 * Integration test — runs against a real Redis.
 *
 * Verifies the DLQ XADD actually accepts the argument order
 * (key, 'MAXLEN', '~', n, '*', field, value, ...). A mock accepts any
 * argument list, so a misplaced MAXLEN would only surface in production —
 * and would surface as a failed dead-letter, i.e. a silently lost message.
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
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { claimStuckMessages } from './claim-stuck-messages';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('claimStuckMessages (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('claimStuckMessages (integration)', () => {
    let redis: Redis;
    const logger = new Logger('claim-integration');
    const stream = 'itest:claim:stream';
    const group = 'itest:claim:group';
    const dlq = 'itest:claim:stream:dlq';

    beforeAll(async () => {
      redis = new Redis(REDIS_TEST_URL);
    });

    afterAll(async () => {
      await redis.quit();
    });

    beforeEach(async () => {
      await redis.del(stream);
      await redis.del(dlq);
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    });

    /** Read a message N times so its delivery count reaches N */
    const deliverTimes = async (times: number): Promise<void> => {
      await redis.xreadgroup(
        'GROUP',
        group,
        'c1',
        'COUNT',
        10,
        'STREAMS',
        stream,
        '>',
      );
      for (let i = 1; i < times; i++) {
        await redis.xclaim(stream, group, 'c1', 0, ...(await pendingIds()));
      }
    };

    const pendingIds = async (): Promise<string[]> => {
      const pending = (await redis.xpending(
        stream,
        group,
        '-',
        '+',
        10,
      )) as Array<[string, string, number, number]>;
      return pending.map(([id]) => id);
    };

    it('should move an exhausted message to the DLQ with MAXLEN accepted by real Redis', async () => {
      await redis.xadd(stream, '*', 'data', '{"failed":"msg"}');
      await deliverTimes(3);

      await claimStuckMessages(
        redis,
        stream,
        group,
        'c1',
        'user-created',
        dlq,
        rs.fn().mockResolvedValue(undefined) as never,
        logger,
        0,
        3,
        10_000,
      );

      const entries = (await redis.xrange(dlq, '-', '+')) as Array<
        [string, string[]]
      >;
      expect(entries).toHaveLength(1);

      const fields = entries[0][1];
      expect(fields).toContain('data');
      expect(fields).toContain('{"failed":"msg"}');
      expect(fields).toContain('topic');
      expect(fields).toContain('user-created');
    });

    it('should ack the original so it stops being redelivered', async () => {
      await redis.xadd(stream, '*', 'data', '{"failed":"msg"}');
      await deliverTimes(3);

      await claimStuckMessages(
        redis,
        stream,
        group,
        'c1',
        'user-created',
        dlq,
        rs.fn().mockResolvedValue(undefined) as never,
        logger,
        0,
        3,
        10_000,
      );

      expect(await pendingIds()).toHaveLength(0);
    });

    it('should trim the DLQ rather than let it grow without bound', async () => {
      // Approximate trimming only drops whole macro-nodes, so assert a bound
      // rather than an exact length — the point is that trimming engages.
      for (let i = 0; i < 300; i++) {
        await redis.xadd(dlq, 'MAXLEN', '~', '50', '*', 'data', `{"n":${i}}`);
      }

      const len = await redis.xlen(dlq);
      expect(len).toBeLessThan(300);
    });

    it('should redeliver instead of dead-lettering when under maxRetries', async () => {
      await redis.xadd(stream, '*', 'data', '{"retry":"msg"}');
      await deliverTimes(1);

      const handler = rs.fn().mockResolvedValue(undefined);
      await claimStuckMessages(
        redis,
        stream,
        group,
        'c1',
        'user-created',
        dlq,
        handler as never,
        logger,
        0,
        3,
        10_000,
      );

      expect(handler).toHaveBeenCalled();
      expect(await redis.xlen(dlq)).toBe(0);
      // Handler succeeded, so the message is acked and no longer pending
      expect(await pendingIds()).toHaveLength(0);
    });
  });
}
