import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteConsumerIfEmpty } from './delete-consumer-if-empty';

describe('deleteConsumerIfEmpty', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;

  beforeEach(() => {
    mockRedis = {
      xpending: rs.fn().mockResolvedValue([]),
      xgroup: rs.fn().mockResolvedValue(1),
    };
    mockLogger = { log: rs.fn(), warn: rs.fn(), error: rs.fn() };
  });

  describe('Standard use cases', () => {
    it('should delete the consumer when it has no pending messages', async () => {
      mockRedis.xpending.mockResolvedValue([]);

      const result = await deleteConsumerIfEmpty(
        mockRedis as never,
        'stream',
        'group',
        'consumer-1',
        mockLogger as never,
      );

      expect(result).toBe(true);
      expect(mockRedis.xgroup).toHaveBeenCalledWith(
        'DELCONSUMER',
        'stream',
        'group',
        'consumer-1',
      );
    });
  });

  describe('Safety guards', () => {
    it('should not delete a consumer that still has pending messages', async () => {
      mockRedis.xpending.mockResolvedValue([['1-0', 'consumer-1', 100, 1]]);

      const result = await deleteConsumerIfEmpty(
        mockRedis as never,
        'stream',
        'group',
        'consumer-1',
        mockLogger as never,
      );

      expect(result).toBe(false);
      expect(mockRedis.xgroup).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should return false and not throw when redis fails', async () => {
      mockRedis.xpending.mockRejectedValue(new Error('CONNRESET'));

      const result = await deleteConsumerIfEmpty(
        mockRedis as never,
        'stream',
        'group',
        'consumer-1',
        mockLogger as never,
      );

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
