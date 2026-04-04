import { describe, it, expect, rs, beforeEach } from '@rstest/core';

rs.mock('../redis/redis.service', () => ({
  RedisService: class {
    getClient = rs.fn().mockReturnValue({
      xadd: rs.fn().mockResolvedValue('1709312000000-0'),
    });
  },
}));

rs.mock('./ensure-consumer-group', () => ({
  ensureConsumerGroup: rs.fn().mockResolvedValue(undefined),
}));

rs.mock('./consumer-loop', () => ({
  startConsumerLoop: rs.fn().mockReturnValue({
    stop: rs.fn().mockResolvedValue(undefined),
  }),
}));

import { MessagingService } from './messaging.service';
import { RedisService } from '../redis/redis.service';
import { ensureConsumerGroup } from './ensure-consumer-group';
import { startConsumerLoop } from './consumer-loop';
import { MessagingError, MessagingErrorCode } from './messaging.error';

describe('MessagingService', () => {
  let service: MessagingService;
  let mockRedisService: RedisService;
  let mockConsumerRedis: Record<string, ReturnType<typeof rs.fn>>;

  beforeEach(() => {
    rs.resetAllMocks();

    // Re-setup mocks after reset
    (RedisService.prototype as unknown as Record<string, unknown>).getClient =
      rs.fn().mockReturnValue({
        xadd: rs.fn().mockResolvedValue('1709312000000-0'),
      });

    rs.mocked(ensureConsumerGroup).mockResolvedValue(undefined);
    rs.mocked(startConsumerLoop).mockReturnValue({
      stop: rs.fn().mockResolvedValue(undefined),
    });

    mockRedisService = new RedisService(null as never);
    mockConsumerRedis = {
      disconnect: rs.fn(),
    };

    // Set PROJECT_NAME for consistent prefix
    process.env.PROJECT_NAME = 'testproject';

    service = new MessagingService(
      mockRedisService,
      {
        consumerGroup: 'offers-service',
        topics: ['user-created'],
        maxRetries: 3,
      },
      mockConsumerRedis as never,
    );
  });

  describe('publish', () => {
    it('should call XADD with correct arguments', async () => {
      const mockXadd = rs.fn().mockResolvedValue('1709312000000-0');
      rs.mocked(mockRedisService.getClient).mockReturnValue({
        xadd: mockXadd,
      } as never);

      const entryId = await service.publish('user-created', { userId: '123' });

      expect(entryId).toBe('1709312000000-0');
      expect(mockXadd).toHaveBeenCalledWith(
        'testproject:messaging:user-created',
        'MAXLEN',
        '~',
        '10000',
        '*',
        'data',
        '{"userId":"123"}',
      );
    });

    it('should throw MessagingError on failure', async () => {
      rs.mocked(mockRedisService.getClient).mockReturnValue({
        xadd: rs.fn().mockRejectedValue(new Error('Redis down')),
      } as never);

      await expect(
        service.publish('user-created', { userId: '123' }),
      ).rejects.toThrow(MessagingError);

      try {
        await service.publish('user-created', { userId: '123' });
      } catch (error) {
        const msgErr = error as MessagingError;
        expect(msgErr.code).toBe(MessagingErrorCode.PUBLISH_FAILED);
        expect(msgErr.topic).toBe('user-created');
      }
    });

    it('should use configured maxLen', async () => {
      const customService = new MessagingService(
        mockRedisService,
        {
          consumerGroup: 'test',
          maxLen: 5000,
        },
        mockConsumerRedis as never,
      );

      const mockXadd = rs.fn().mockResolvedValue('1-0');
      rs.mocked(mockRedisService.getClient).mockReturnValue({
        xadd: mockXadd,
      } as never);

      await customService.publish('test-topic', { x: 1 });

      expect(mockXadd).toHaveBeenCalledWith(
        expect.any(String),
        'MAXLEN',
        '~',
        '5000',
        '*',
        'data',
        expect.any(String),
      );
    });
  });

  describe('registerHandler', () => {
    it('should register a handler for a topic', () => {
      const handler = rs.fn().mockResolvedValue(undefined);
      service.registerHandler('user-created', handler);

      // Handler is stored internally — verified via start()
      expect(() =>
        service.registerHandler('another-topic', handler),
      ).not.toThrow();
    });
  });

  describe('start', () => {
    it('should create consumer groups and start loops', async () => {
      const handler = rs.fn().mockResolvedValue(undefined);
      service.registerHandler('user-created', handler);

      await service.start();

      expect(ensureConsumerGroup).toHaveBeenCalledWith(
        mockConsumerRedis,
        'testproject:messaging:user-created',
        'testproject:messaging:user-created:offers-service',
        expect.any(Object),
      );
      expect(startConsumerLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          redis: mockConsumerRedis,
          streamKey: 'testproject:messaging:user-created',
          groupName: 'testproject:messaging:user-created:offers-service',
          topic: 'user-created',
          dlqStreamKey: 'testproject:messaging:user-created:dlq',
        }),
      );
    });

    it('should warn when no handler found for a topic', async () => {
      // Don't register any handler
      await service.start();

      // startConsumerLoop should not be called for topics without handlers
      expect(startConsumerLoop).not.toHaveBeenCalled();
    });

    it('should be idempotent', async () => {
      const handler = rs.fn().mockResolvedValue(undefined);
      service.registerHandler('user-created', handler);

      await service.start();
      await service.start();

      // Should only create one consumer loop
      expect(startConsumerLoop).toHaveBeenCalledTimes(1);
    });

    it('should log publish-only mode when no topics', async () => {
      const publishOnlyService = new MessagingService(
        mockRedisService,
        { consumerGroup: 'auth-service' },
        mockConsumerRedis as never,
      );

      await publishOnlyService.start();

      expect(startConsumerLoop).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop consumer loops and disconnect', async () => {
      const mockStop = rs.fn().mockResolvedValue(undefined);
      rs.mocked(startConsumerLoop).mockReturnValue({ stop: mockStop });

      const handler = rs.fn().mockResolvedValue(undefined);
      service.registerHandler('user-created', handler);
      await service.start();

      await service.onModuleDestroy();

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockConsumerRedis.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
