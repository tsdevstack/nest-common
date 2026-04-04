import { describe, it, expect, rs } from '@rstest/core';
import { ensureConsumerGroup } from './ensure-consumer-group';

describe('ensureConsumerGroup', () => {
  it('should create consumer group with MKSTREAM', async () => {
    const mockRedis = {
      xgroup: rs.fn().mockResolvedValue('OK'),
    };
    const mockLogger = { log: rs.fn() };

    await ensureConsumerGroup(
      mockRedis as never,
      'stream-key',
      'group-name',
      mockLogger as never,
    );

    expect(mockRedis.xgroup).toHaveBeenCalledWith(
      'CREATE',
      'stream-key',
      'group-name',
      '0',
      'MKSTREAM',
    );
  });

  it('should ignore BUSYGROUP error (group already exists)', async () => {
    const mockRedis = {
      xgroup: rs
        .fn()
        .mockRejectedValue(
          new Error('BUSYGROUP Consumer Group name already exists'),
        ),
    };
    const mockLogger = { log: rs.fn() };

    // Should not throw
    await ensureConsumerGroup(
      mockRedis as never,
      'stream-key',
      'group-name',
      mockLogger as never,
    );
  });

  it('should rethrow non-BUSYGROUP errors', async () => {
    const mockRedis = {
      xgroup: rs.fn().mockRejectedValue(new Error('Connection refused')),
    };
    const mockLogger = { log: rs.fn() };

    await expect(
      ensureConsumerGroup(
        mockRedis as never,
        'stream-key',
        'group-name',
        mockLogger as never,
      ),
    ).rejects.toThrow('Connection refused');
  });
});
