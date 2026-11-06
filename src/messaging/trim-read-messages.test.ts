import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { trimReadMessages } from './trim-read-messages';

/** One group as XINFO GROUPS returns it */
const group = (
  name: string,
  pending: number,
  lastDeliveredId: string,
): unknown[] => [
  'name',
  name,
  'consumers',
  1,
  'pending',
  pending,
  'last-delivered-id',
  lastDeliveredId,
  'entries-read',
  1,
  'lag',
  0,
];

describe('trimReadMessages', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;

  beforeEach(() => {
    mockRedis = {
      xinfo: rs.fn().mockResolvedValue([]),
      xpending: rs.fn().mockResolvedValue([0, null, null, null]),
      xtrim: rs.fn().mockResolvedValue(0),
    };
    mockLogger = { log: rs.fn(), warn: rs.fn(), error: rs.fn() };
  });

  const run = (): Promise<void> =>
    trimReadMessages(
      mockRedis as never,
      'app:messaging:topic',
      mockLogger as never,
    );

  describe('Standard use cases', () => {
    it('should delete everything before the last delivered entry when nothing is pending', async () => {
      mockRedis.xinfo.mockResolvedValue([group('g1', 0, '5-0')]);

      await run();

      expect(mockRedis.xpending).not.toHaveBeenCalled();
      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'MINID',
        '~',
        '5-0',
      );
    });

    it('should keep the oldest pending entry and everything after it', async () => {
      mockRedis.xinfo.mockResolvedValue([group('g1', 2, '5-0')]);
      mockRedis.xpending.mockResolvedValue([2, '3-0', '5-0', [['c1', '2']]]);

      await run();

      expect(mockRedis.xpending).toHaveBeenCalledWith(
        'app:messaging:topic',
        'g1',
      );
      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'MINID',
        '~',
        '3-0',
      );
    });

    it('should keep what the group furthest behind still needs', async () => {
      mockRedis.xinfo.mockResolvedValue([
        group('ahead', 0, '9-0'),
        group('behind', 0, '4-0'),
      ]);

      await run();

      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'MINID',
        '~',
        '4-0',
      );
    });

    it('should compare entry IDs as numbers, not text', async () => {
      mockRedis.xinfo.mockResolvedValue([
        group('g1', 0, '1000-0'),
        group('g2', 0, '999-5'),
      ]);

      await run();

      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'MINID',
        '~',
        '999-5',
      );
    });
  });

  describe('Edge cases', () => {
    it('should not trim a stream without subscriber groups', async () => {
      await run();

      expect(mockRedis.xtrim).not.toHaveBeenCalled();
    });

    it('should not trim while a group has read nothing yet', async () => {
      mockRedis.xinfo.mockResolvedValue([
        group('g1', 0, '9-0'),
        group('new', 0, '0-0'),
      ]);

      await run();

      expect(mockRedis.xtrim).not.toHaveBeenCalled();
    });

    it('should log and not throw when Redis fails', async () => {
      mockRedis.xinfo.mockRejectedValue(new Error('Connection reset'));

      await expect(run()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Connection reset'),
      );
    });
  });
});
