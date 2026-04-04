import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { claimStuckMessages } from './claim-stuck-messages';

describe('claimStuckMessages', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;
  let mockHandler: ReturnType<typeof rs.fn>;

  beforeEach(() => {
    mockRedis = {
      xpending: rs.fn().mockResolvedValue([]),
      xrange: rs.fn().mockResolvedValue([]),
      xclaim: rs.fn().mockResolvedValue([]),
      xack: rs.fn().mockResolvedValue(1),
      xadd: rs.fn().mockResolvedValue('1-0'),
    };
    mockLogger = {
      log: rs.fn(),
      warn: rs.fn(),
      error: rs.fn(),
    };
    mockHandler = rs.fn().mockResolvedValue(undefined);
  });

  it('should do nothing when no pending messages', async () => {
    mockRedis.xpending.mockResolvedValue([]);

    await claimStuckMessages(
      mockRedis as never,
      'stream-key',
      'group-name',
      'consumer-1',
      'topic',
      'stream-key:dlq',
      mockHandler,
      mockLogger as never,
      60000,
      3,
    );

    expect(mockRedis.xclaim).not.toHaveBeenCalled();
    expect(mockRedis.xadd).not.toHaveBeenCalled();
  });

  it('should skip messages that are not idle long enough', async () => {
    // idle 10ms, below 60000ms threshold
    mockRedis.xpending.mockResolvedValue([['1-0', 'consumer-1', 10, 1]]);

    await claimStuckMessages(
      mockRedis as never,
      'stream-key',
      'group-name',
      'consumer-1',
      'topic',
      'stream-key:dlq',
      mockHandler,
      mockLogger as never,
      60000,
      3,
    );

    expect(mockRedis.xclaim).not.toHaveBeenCalled();
  });

  it('should move message to DLQ when maxRetries exceeded', async () => {
    // idle 120000ms, delivery count 3 (>= maxRetries 3)
    mockRedis.xpending.mockResolvedValue([['1-0', 'consumer-1', 120000, 3]]);
    mockRedis.xrange.mockResolvedValue([['1-0', ['data', '{"failed":"msg"}']]]);

    await claimStuckMessages(
      mockRedis as never,
      'stream-key',
      'group-name',
      'consumer-1',
      'topic',
      'stream-key:dlq',
      mockHandler,
      mockLogger as never,
      60000,
      3,
    );

    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'stream-key:dlq',
      '*',
      'data',
      '{"failed":"msg"}',
      'originalId',
      '1-0',
      'deliveryCount',
      '3',
      'topic',
      'topic',
    );
    expect(mockRedis.xack).toHaveBeenCalledWith(
      'stream-key',
      'group-name',
      '1-0',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('moved to DLQ'),
    );
  });

  it('should reclaim and redeliver when under maxRetries', async () => {
    // idle 120000ms, delivery count 1 (< maxRetries 3)
    mockRedis.xpending.mockResolvedValue([['1-0', 'consumer-1', 120000, 1]]);
    mockRedis.xclaim.mockResolvedValue([['1-0', ['data', '{"retry":"msg"}']]]);

    await claimStuckMessages(
      mockRedis as never,
      'stream-key',
      'group-name',
      'consumer-1',
      'topic',
      'stream-key:dlq',
      mockHandler,
      mockLogger as never,
      60000,
      3,
    );

    expect(mockRedis.xclaim).toHaveBeenCalledWith(
      'stream-key',
      'group-name',
      'consumer-1',
      60000,
      '1-0',
    );
    expect(mockHandler).toHaveBeenCalled();
    expect(mockRedis.xack).toHaveBeenCalledWith(
      'stream-key',
      'group-name',
      '1-0',
    );
  });

  it('should leave message pending when redelivery handler fails', async () => {
    mockRedis.xpending.mockResolvedValue([['1-0', 'consumer-1', 120000, 1]]);
    mockRedis.xclaim.mockResolvedValue([['1-0', ['data', '{"retry":"msg"}']]]);
    mockHandler.mockRejectedValueOnce(new Error('Still failing'));

    await claimStuckMessages(
      mockRedis as never,
      'stream-key',
      'group-name',
      'consumer-1',
      'topic',
      'stream-key:dlq',
      mockHandler,
      mockLogger as never,
      60000,
      3,
    );

    expect(mockHandler).toHaveBeenCalled();
    // xack should NOT be called since handler failed
    expect(mockRedis.xack).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Retry 1 failed'),
    );
  });
});
