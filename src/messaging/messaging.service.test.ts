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

    it('should warn but still publish when the payload is oversized', async () => {
      const customService = new MessagingService(
        mockRedisService,
        { consumerGroup: 'test', maxPayloadBytes: 100 },
        mockConsumerRedis as never,
      );
      const warn = rs.spyOn(
        (customService as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      );

      const mockXadd = rs.fn().mockResolvedValue('1-0');
      rs.mocked(mockRedisService.getClient).mockReturnValue({
        xadd: mockXadd,
      } as never);

      // Publishing must keep working — an upgrade cannot break a running service
      await expect(
        customService.publish('test-topic', { blob: 'x'.repeat(500) }),
      ).resolves.toBe('1-0');

      expect(mockXadd).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('over the 100 byte limit'),
      );
    });

    it('should measure bytes not characters', async () => {
      const customService = new MessagingService(
        mockRedisService,
        { consumerGroup: 'test', maxPayloadBytes: 40 },
        mockConsumerRedis as never,
      );
      const warn = rs.spyOn(
        (customService as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      );

      rs.mocked(mockRedisService.getClient).mockReturnValue({
        xadd: rs.fn().mockResolvedValue('1-0'),
      } as never);

      // 20 multi-byte chars serialize to well over 40 bytes
      await customService.publish('test-topic', { s: '€'.repeat(20) });

      expect(warn).toHaveBeenCalled();
    });

    it('should stay silent for payloads under the limit', async () => {
      const customService = new MessagingService(
        mockRedisService,
        { consumerGroup: 'test', maxPayloadBytes: 1000 },
        mockConsumerRedis as never,
      );
      const warn = rs.spyOn(
        (customService as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      );

      rs.mocked(mockRedisService.getClient).mockReturnValue({
        xadd: rs.fn().mockResolvedValue('1-0'),
      } as never);

      await expect(
        customService.publish('test-topic', { ok: true }),
      ).resolves.toBe('1-0');

      expect(warn).not.toHaveBeenCalled();
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

    it('should deregister its consumer when nothing is pending', async () => {
      mockConsumerRedis.xpending = rs.fn().mockResolvedValue([]);
      mockConsumerRedis.xgroup = rs.fn().mockResolvedValue(1);

      const handler = rs.fn().mockResolvedValue(undefined);
      service.registerHandler('user-created', handler);
      await service.start();
      await service.onModuleDestroy();

      expect(mockConsumerRedis.xgroup).toHaveBeenCalledWith(
        'DELCONSUMER',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    it('should keep its consumer when messages are still pending', async () => {
      mockConsumerRedis.xpending = rs
        .fn()
        .mockResolvedValue([['1-0', 'consumer', 100, 1]]);
      mockConsumerRedis.xgroup = rs.fn().mockResolvedValue(1);

      const handler = rs.fn().mockResolvedValue(undefined);
      service.registerHandler('user-created', handler);
      await service.start();
      await service.onModuleDestroy();

      expect(mockConsumerRedis.xgroup).not.toHaveBeenCalled();
    });
  });

  describe('consumer identity', () => {
    const consumerNameFromLastStart = (): string =>
      (
        rs.mocked(startConsumerLoop).mock.calls[0][0] as {
          consumerName: string;
        }
      ).consumerName;

    it('should be shaped group:hostname:pid:instance', async () => {
      service.registerHandler(
        'user-created',
        rs.fn().mockResolvedValue(undefined),
      );
      await service.start();

      const consumerName = consumerNameFromLastStart();

      expect(consumerName.split(':')).toHaveLength(4);
      expect(consumerName.startsWith('offers-service:')).toBe(true);
      expect(consumerName.split(':')[2]).toBe(String(process.pid));
      expect(consumerName.split(':')[3]).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should differ between two instances of the same service', async () => {
      // Uniqueness must not depend on the runtime handing out distinct
      // hostnames — two services here share a hostname and a PID.
      service.registerHandler(
        'user-created',
        rs.fn().mockResolvedValue(undefined),
      );
      await service.start();
      const first = consumerNameFromLastStart();

      const second = new MessagingService(
        mockRedisService,
        { consumerGroup: 'offers-service', topics: ['user-created'] },
        mockConsumerRedis as never,
      );
      second.registerHandler(
        'user-created',
        rs.fn().mockResolvedValue(undefined),
      );
      await second.start();

      const secondName = (
        rs.mocked(startConsumerLoop).mock.calls[1][0] as {
          consumerName: string;
        }
      ).consumerName;

      expect(secondName).not.toBe(first);
    });
  });
});
