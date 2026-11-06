/**
 * Integration test — runs against a real Redis.
 *
 * Verifies that a consumer still handling a message keeps it: the
 * "still working" signal (XPENDING per consumer + XCLAIM JUSTID) resets the
 * idle time without counting a delivery, so another instance's stuck-message
 * check doesn't take the message, and a message another instance already took
 * over stays with it.
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
import { keepMessagesClaimed } from './keep-messages-claimed';
import { claimStuckMessages } from './claim-stuck-messages';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('keepMessagesClaimed (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('keepMessagesClaimed (integration)', () => {
    let redis: Redis;
    const logger = new Logger('keep-claimed-integration');
    const stream = 'itest:keep:stream';
    const group = 'itest:keep:group';
    const dlq = 'itest:keep:stream:dlq';

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

    /** Publish one message and deliver it to consumer c1 */
    const deliverToC1 = async (): Promise<string> => {
      const id = (await redis.xadd(stream, '*', 'data', '{"n":1}')) as string;
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
      return id;
    };

    const pendingEntry = async (): Promise<[string, string, number, number]> =>
      (
        (await redis.xpending(stream, group, '-', '+', 10)) as Array<
          [string, string, number, number]
        >
      )[0];

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    it('should stop another consumer from taking a message still being handled', async () => {
      const id = await deliverToC1();
      await wait(300);

      await keepMessagesClaimed(redis, stream, group, 'c1', [id]);

      const handler = rs.fn().mockResolvedValue(undefined);
      await claimStuckMessages(
        redis,
        stream,
        group,
        'c2',
        'topic',
        dlq,
        handler,
        logger,
        250,
        3,
      );

      expect(handler).not.toHaveBeenCalled();
      const [, owner] = await pendingEntry();
      expect(owner).toBe('c1');
    });

    it('should not count a delivery', async () => {
      const id = await deliverToC1();

      await keepMessagesClaimed(redis, stream, group, 'c1', [id]);
      await keepMessagesClaimed(redis, stream, group, 'c1', [id]);

      const [, , , deliveryCount] = await pendingEntry();
      expect(deliveryCount).toBe(1);
    });

    it('should leave a message another consumer took over with it', async () => {
      const id = await deliverToC1();
      await redis.xclaim(stream, group, 'c2', 0, id);

      await keepMessagesClaimed(redis, stream, group, 'c1', [id]);

      const [, owner] = await pendingEntry();
      expect(owner).toBe('c2');
    });

    it('should let another consumer take a message once the signals stop (a crash)', async () => {
      await deliverToC1();
      await wait(300);

      const handler = rs.fn().mockResolvedValue(undefined);
      await claimStuckMessages(
        redis,
        stream,
        group,
        'c2',
        'topic',
        dlq,
        handler,
        logger,
        250,
        3,
      );

      expect(handler).toHaveBeenCalled();
    });
  });
}
