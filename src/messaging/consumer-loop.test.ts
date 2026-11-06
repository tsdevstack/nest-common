import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { startConsumerLoop } from './consumer-loop';

describe('startConsumerLoop', () => {
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;
  let mockLogger: Record<string, ReturnType<typeof rs.fn>>;
  let mockHandler: ReturnType<typeof rs.fn>;
  let pipeline: Record<string, ReturnType<typeof rs.fn>>;

  beforeEach(() => {
    mockRedis = {
      xreadgroup: rs.fn().mockResolvedValue(null),
      xack: rs.fn().mockResolvedValue(1),
      xpending: rs.fn().mockResolvedValue([]),
      xrange: rs.fn().mockResolvedValue([]),
      xclaim: rs.fn().mockResolvedValue([]),
      xadd: rs.fn().mockResolvedValue('1-0'),
    };
    pipeline = {
      xpending: rs.fn(),
      exec: rs.fn().mockResolvedValue([
        [null, [['1-0', 'service:1234', 1_000, 1]]],
        [null, [['2-0', 'service:1234', 1_000, 1]]],
      ]),
    };
    pipeline.xpending.mockReturnValue(pipeline);
    mockRedis.pipeline = rs.fn().mockReturnValue(pipeline);
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

  it('should recreate the consumer group on NOGROUP and keep reading', async () => {
    mockRedis.xreadgroup
      .mockRejectedValueOnce(
        new Error(
          "NOGROUP No such key 'test:messaging:topic' or consumer group 'test:messaging:topic:service' in XREADGROUP with GROUP option",
        ),
      )
      .mockResolvedValue(null);
    mockRedis.xgroup = rs.fn().mockResolvedValue('OK');

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

    expect(mockRedis.xgroup).toHaveBeenCalledWith(
      'CREATE',
      'test:messaging:topic',
      'test:messaging:topic:service',
      '0',
      'MKSTREAM',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('recreating'),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockRedis.xreadgroup.mock.calls.length).toBeGreaterThan(1);
  });

  describe('While handlers run', () => {
    const start = (): { stop: () => Promise<void> } =>
      startConsumerLoop({
        redis: mockRedis as never,
        streamKey: 'test:messaging:topic',
        groupName: 'test:messaging:topic:service',
        consumerName: 'service:1234',
        topic: 'topic',
        dlqStreamKey: 'test:messaging:topic:dlq',
        handler: mockHandler,
        logger: mockLogger as never,
        blockTimeMs: 10,
        // Heartbeat every second (a third of this, at least 1 s)
        claimMinIdleMs: 3_000,
      });

    it('should keep the running message and the rest of its batch claimed', async () => {
      mockRedis.xreadgroup
        .mockResolvedValueOnce([
          [
            'test:messaging:topic',
            [
              ['1-0', ['data', '{"n":1}']],
              ['2-0', ['data', '{"n":2}']],
            ],
          ],
        ])
        .mockResolvedValue(null);
      mockHandler.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1_300)),
      );

      const { stop } = start();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await stop();

      expect(pipeline.xpending).toHaveBeenCalledWith(
        'test:messaging:topic',
        'test:messaging:topic:service',
        '2-0',
        '2-0',
        1,
        'service:1234',
      );
      expect(mockRedis.xclaim).toHaveBeenCalledWith(
        'test:messaging:topic',
        'test:messaging:topic:service',
        'service:1234',
        0,
        '1-0',
        '2-0',
        'JUSTID',
      );
    });

    it('should not signal anything once its handlers finished', async () => {
      mockRedis.xreadgroup
        .mockResolvedValueOnce([
          ['test:messaging:topic', [['1-0', ['data', '{"n":1}']]]],
        ])
        .mockResolvedValue(null);

      const { stop } = start();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await stop();

      expect(mockRedis.xack).toHaveBeenCalled();
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(mockRedis.xclaim).not.toHaveBeenCalled();
    });

    it('should keep a failed message no longer claimed (the stuck-message check retries it)', async () => {
      mockHandler.mockRejectedValueOnce(new Error('Handler failed'));
      mockRedis.xreadgroup
        .mockResolvedValueOnce([
          ['test:messaging:topic', [['1-0', ['data', '{"n":1}']]]],
        ])
        .mockResolvedValue(null);

      const { stop } = start();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await stop();

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });
  });
});
