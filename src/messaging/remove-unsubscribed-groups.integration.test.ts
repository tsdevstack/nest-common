/**
 * Integration test — runs against a real Redis.
 *
 * Verifies that SCAN ... TYPE stream, XINFO CONSUMERS and XGROUP DESTROY
 * behave as the code expects: a service's group on a topic it left is
 * removed, and nothing else is.
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
import { removeUnsubscribedGroups } from './remove-unsubscribed-groups';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

if (!REDIS_TEST_URL) {
  describe('removeUnsubscribedGroups (integration)', () => {
    it('skipped — set REDIS_TEST_URL to run', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('removeUnsubscribedGroups (integration)', () => {
    let redis: Redis;
    const logger = new Logger('remove-groups-integration');
    const left = 'itestrg:messaging:left-topic';
    const kept = 'itestrg:messaging:kept-topic';

    beforeAll(async () => {
      redis = new Redis(REDIS_TEST_URL);
    });

    afterAll(async () => {
      await redis.del(left, kept);
      await redis.quit();
    });

    beforeEach(async () => {
      await redis.del(left, kept);
      for (const stream of [left, kept]) {
        await redis.xadd(stream, '*', 'data', '{}');
        await redis.xgroup('CREATE', stream, `${stream}:svc`, '0');
        await redis.xgroup('CREATE', stream, `${stream}:other`, '0');
      }
    });

    const groups = async (stream: string): Promise<string[]> =>
      ((await redis.xinfo('GROUPS', stream)) as unknown[][]).map(
        (group) => group[1] as string,
      );

    const read = (stream: string, group: string): Promise<unknown> =>
      redis.xreadgroup(
        'GROUP',
        group,
        'c1',
        'COUNT',
        1,
        'STREAMS',
        stream,
        '>',
      );

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    it("should remove only the service's group on the topic it left", async () => {
      await removeUnsubscribedGroups(
        redis,
        'itestrg',
        'svc',
        ['kept-topic'],
        logger,
        200,
      );

      expect(await groups(left)).toEqual([`${left}:other`]);
      expect((await groups(kept)).sort()).toEqual([
        `${kept}:other`,
        `${kept}:svc`,
      ]);
    });

    it('should keep the group while a consumer still reads it', async () => {
      await read(left, `${left}:svc`);

      await removeUnsubscribedGroups(
        redis,
        'itestrg',
        'svc',
        [],
        logger,
        60_000,
      );

      expect(await groups(left)).toContain(`${left}:svc`);
    });

    it('should remove the group once its consumers stopped reading', async () => {
      await read(left, `${left}:svc`);
      await wait(300);

      await removeUnsubscribedGroups(redis, 'itestrg', 'svc', [], logger, 200);

      expect(await groups(left)).toEqual([`${left}:other`]);
    });
  });
}
