import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { reapIdleConsumers } from './reap-idle-consumers';

describe('reapIdleConsumers', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;

  const consumer = (name: string, pending: number, idle: number): unknown[] => [
    'name',
    name,
    'pending',
    pending,
    'idle',
    idle,
  ];

  beforeEach(() => {
    mockRedis = {
      xinfo: rs.fn().mockResolvedValue([]),
      xgroup: rs.fn().mockResolvedValue(1),
    };
    mockLogger = { log: rs.fn(), warn: rs.fn(), error: rs.fn() };
  });

  describe('Standard use cases', () => {
    it('should delete an idle consumer with no pending messages', async () => {
      mockRedis.xinfo.mockResolvedValue([consumer('dead-host:2', 0, 900000)]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'DELCONSUMER',
        'stream',
        'group',
        'dead-host:2',
      );
    });

    it('should reap several dead consumers in one sweep', async () => {
      mockRedis.xinfo.mockResolvedValue([
        consumer('dead-a', 0, 900000),
        consumer('dead-b', 0, 900000),
      ]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).toHaveBeenCalledTimes(2);
    });
  });

  describe('Safety guards', () => {
    it('should never delete a consumer holding pending messages', async () => {
      mockRedis.xinfo.mockResolvedValue([consumer('dead-host:2', 3, 900000)]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });

    it('should never delete itself', async () => {
      mockRedis.xinfo.mockResolvedValue([consumer('self:1', 0, 900000)]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });

    it('should leave recently active consumers alone', async () => {
      mockRedis.xinfo.mockResolvedValue([consumer('live-host:2', 0, 4000)]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should do nothing when the group has no consumers', async () => {
      mockRedis.xinfo.mockResolvedValue([]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });

    it('should skip malformed entries rather than throw', async () => {
      mockRedis.xinfo.mockResolvedValue([
        ['name', 'partial'],
        consumer('dead-host:2', 0, 900000),
      ]);

      await reapIdleConsumers(
        mockRedis as never,
        'stream',
        'group',
        'self:1',
        mockLogger as never,
        600000,
      );

      expect(mockRedis.xgroup).toHaveBeenCalledTimes(1);
    });

    it('should swallow redis errors so the consumer loop keeps running', async () => {
      mockRedis.xinfo.mockRejectedValue(new Error('CONNRESET'));

      await expect(
        reapIdleConsumers(
          mockRedis as never,
          'stream',
          'group',
          'self:1',
          mockLogger as never,
          600000,
        ),
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
