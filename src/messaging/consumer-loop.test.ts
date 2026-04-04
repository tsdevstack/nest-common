import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { startConsumerLoop } from './consumer-loop';

describe('startConsumerLoop', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;
  let mockHandler: ReturnType<typeof rs.fn>;

  beforeEach(() => {
    mockRedis = {
      xreadgroup: rs.fn().mockResolvedValue(null),
      xack: rs.fn().mockResolvedValue(1),
      xpending: rs.fn().mockResolvedValue([]),
      xrange: rs.fn().mockResolvedValue([]),
      xclaim: rs.fn().mockResolvedValue([]),
      xadd: rs.fn().mockResolvedValue('1-0'),
    };
    mockLogger = {
      log: rs.fn(),
      warn: rs.fn(),
      error: rs.fn(),
    };
    mockHandler = rs.fn().mockResolvedValue(undefined);
  });

  it('should stop cleanly when no messages', async () => {
    const { stop } = startConsumerLoop({
      redis: mockRedis as never,
      streamKey: 'test:messaging:topic',
      groupName: 'test:messaging:topic:service',
      consumerName: 'service:1234',
      topic: 'topic',
      dlqStreamKey: 'test:messaging:topic:dlq',
      handler: mockHandler,
      logger: mockLogger as never,
      blockTimeMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await stop();

    expect(mockRedis.xreadgroup).toHaveBeenCalled();
  });

  it('should call handler and XACK on success', async () => {
    mockRedis.xreadgroup
      .mockResolvedValueOnce([
        [
          'test:messaging:topic',
          [['1709312000000-0', ['data', '{"userId":"123"}']]],
        ],
      ])
      .mockResolvedValue(null);

    const { stop } = startConsumerLoop({
      redis: mockRedis as never,
      streamKey: 'test:messaging:topic',
      groupName: 'test:messaging:topic:service',
      consumerName: 'service:1234',
      topic: 'topic',
      dlqStreamKey: 'test:messaging:topic:dlq',
      handler: mockHandler,
      logger: mockLogger as never,
      blockTimeMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await stop();

    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1709312000000-0',
        topic: 'topic',
        data: { userId: '123' },
      }),
    );
    expect(mockRedis.xack).toHaveBeenCalledWith(
      'test:messaging:topic',
      'test:messaging:topic:service',
      '1709312000000-0',
    );
  });

  it('should not XACK when handler throws', async () => {
    mockHandler.mockRejectedValueOnce(new Error('Handler failed'));
    mockRedis.xreadgroup
      .mockResolvedValueOnce([
        ['test:messaging:topic', [['1709312000000-0', ['data', '{"x":1}']]]],
      ])
      .mockResolvedValue(null);

    const { stop } = startConsumerLoop({
      redis: mockRedis as never,
      streamKey: 'test:messaging:topic',
      groupName: 'test:messaging:topic:service',
      consumerName: 'service:1234',
      topic: 'topic',
      dlqStreamKey: 'test:messaging:topic:dlq',
      handler: mockHandler,
      logger: mockLogger as never,
      blockTimeMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await stop();

    expect(mockHandler).toHaveBeenCalled();
    expect(mockRedis.xack).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Handler failed'),
    );
  });

  it('should handle transient Redis errors without crashing', async () => {
    mockRedis.xreadgroup
      .mockRejectedValueOnce(new Error('Connection reset'))
      .mockResolvedValue(null);

    const { stop } = startConsumerLoop({
      redis: mockRedis as never,
      streamKey: 'test:messaging:topic',
      groupName: 'test:messaging:topic:service',
      consumerName: 'service:1234',
      topic: 'topic',
      dlqStreamKey: 'test:messaging:topic:dlq',
      handler: mockHandler,
      logger: mockLogger as never,
      blockTimeMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await stop();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Connection reset'),
    );
    expect(mockRedis.xreadgroup.mock.calls.length).toBeGreaterThan(1);
  });
});
