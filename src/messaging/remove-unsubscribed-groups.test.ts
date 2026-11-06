import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { removeUnsubscribedGroups } from './remove-unsubscribed-groups';

/** One consumer as XINFO CONSUMERS returns it */
const consumer = (name: string, idle: number): unknown[] => [
  'name',
  name,
  'pending',
  0,
  'idle',
  idle,
];

describe('removeUnsubscribedGroups', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;

  beforeEach(() => {
    mockRedis = {
      scan: rs.fn().mockResolvedValue(['0', []]),
      xinfo: rs.fn().mockResolvedValue([]),
      xgroup: rs.fn().mockResolvedValue(1),
    };
    mockLogger = { log: rs.fn(), warn: rs.fn(), error: rs.fn() };
  });

  const run = (topics: string[]): Promise<void> =>
    removeUnsubscribedGroups(
      mockRedis as never,
      'app',
      'offers-service',
      topics,
      mockLogger as never,
      600_000,
    );

  describe('Standard use cases', () => {
    it('should remove its group on a topic it no longer subscribes to', async () => {
      mockRedis.scan.mockResolvedValue([
        '0',
        ['app:messaging:user-registered'],
      ]);
      mockRedis.xinfo.mockResolvedValue([consumer('old', 900_000)]);

      await run([]);

      expect(mockRedis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'app:messaging:*',
        'COUNT',
        100,
        'TYPE',
        'stream',
      );
      expect(mockRedis.xinfo).toHaveBeenCalledWith(
        'CONSUMERS',
        'app:messaging:user-registered',
        'app:messaging:user-registered:offers-service',
      );
      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'DESTROY',
        'app:messaging:user-registered',
        'app:messaging:user-registered:offers-service',
      );
    });

    it('should remove a group with no consumers left', async () => {
      mockRedis.scan.mockResolvedValue([
        '0',
        ['app:messaging:user-registered'],
      ]);

      await run([]);

      expect(mockRedis.xgroup).toHaveBeenCalled();
    });

    it('should keep the groups of topics it subscribes to', async () => {
      mockRedis.scan.mockResolvedValue([
        '0',
        ['app:messaging:user-registered'],
      ]);

      await run(['user-registered']);

      expect(mockRedis.xinfo).not.toHaveBeenCalled();
      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });

    it('should keep a group a previous version still reads (right after a deploy)', async () => {
      mockRedis.scan.mockResolvedValue([
        '0',
        ['app:messaging:user-registered'],
      ]);
      mockRedis.xinfo.mockResolvedValue([
        consumer('dead', 900_000),
        consumer('previous-version', 4_000),
      ]);

      await run([]);

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });

    it('should follow the scan cursor until Redis says it is done', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['17', ['app:messaging:a']])
        .mockResolvedValueOnce(['0', ['app:messaging:b']]);

      await run([]);

      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
      expect(mockRedis.scan.mock.calls[1][0]).toBe('17');
      expect(mockRedis.xgroup).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge cases', () => {
    it('should skip dead-letter streams', async () => {
      mockRedis.scan.mockResolvedValue([
        '0',
        ['app:messaging:user-registered:dlq'],
      ]);

      await run([]);

      expect(mockRedis.xinfo).not.toHaveBeenCalled();
    });

    it('should skip topics this service never subscribed to', async () => {
      mockRedis.scan.mockResolvedValue(['0', ['app:messaging:orders']]);
      mockRedis.xinfo.mockRejectedValue(
        new Error("NOGROUP No such consumer group 'x' for key name 'y'"),
      );

      await run([]);

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should keep a group when a consumer has no idle time', async () => {
      mockRedis.scan.mockResolvedValue([
        '0',
        ['app:messaging:user-registered'],
      ]);
      mockRedis.xinfo.mockResolvedValue([['name', 'odd']]);

      await run([]);

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });

    it('should log and not throw when Redis fails', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Connection reset'));

      await expect(run([])).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Connection reset'),
      );
    });
  });
});
