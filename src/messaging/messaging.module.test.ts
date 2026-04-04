import { describe, it, expect, rs } from '@rstest/core';

rs.mock('../secrets/secrets.module', () => ({
  SecretsModule: class {},
}));

rs.mock('../secrets/secrets.service', () => ({
  SecretsService: class {},
}));

rs.mock('../redis/redis.module', () => ({
  RedisModule: class {},
}));

rs.mock('./messaging.service', () => ({
  MessagingService: class {},
}));

rs.mock('ioredis', () => {
  return {
    default: class MockRedis {
      connect = rs.fn().mockResolvedValue(undefined);
      disconnect = rs.fn();
    },
  };
});

import { MessagingModule } from './messaging.module';
import { MessagingService } from './messaging.service';
import {
  MESSAGING_OPTIONS_TOKEN,
  MESSAGING_CONSUMER_REDIS_TOKEN,
} from './messaging.constants';

describe('MessagingModule', () => {
  describe('forRoot', () => {
    it('should return a DynamicModule with correct providers', () => {
      const result = MessagingModule.forRoot({
        consumerGroup: 'offers-service',
        topics: ['user-created'],
      });

      expect(result.module).toBe(MessagingModule);
      expect(result.global).toBe(true);
    });

    it('should export MessagingService', () => {
      const result = MessagingModule.forRoot({
        consumerGroup: 'test',
      });

      expect(result.exports).toContain(MessagingService);
    });

    it('should provide MESSAGING_OPTIONS_TOKEN with options value', () => {
      const options = {
        consumerGroup: 'offers-service',
        topics: ['user-created'],
        maxRetries: 5,
      };

      const result = MessagingModule.forRoot(options);

      const optionsProvider = result.providers?.find(
        (p) =>
          typeof p === 'object' &&
          'provide' in p &&
          p.provide === MESSAGING_OPTIONS_TOKEN,
      );
      expect(optionsProvider).toBeDefined();
      expect((optionsProvider as { useValue: unknown }).useValue).toBe(options);
    });

    it('should provide MESSAGING_CONSUMER_REDIS_TOKEN', () => {
      const result = MessagingModule.forRoot({
        consumerGroup: 'test',
        topics: ['test-topic'],
      });

      const redisProvider = result.providers?.find(
        (p) =>
          typeof p === 'object' &&
          'provide' in p &&
          p.provide === MESSAGING_CONSUMER_REDIS_TOKEN,
      );
      expect(redisProvider).toBeDefined();
      expect(
        (redisProvider as { useFactory: unknown }).useFactory,
      ).toBeDefined();
    });

    it('should import SecretsModule and RedisModule', () => {
      const result = MessagingModule.forRoot({
        consumerGroup: 'test',
      });

      expect(result.imports).toBeDefined();
      expect(result.imports!.length).toBe(2);
    });
  });

  describe('forRootAsync', () => {
    it('should return a DynamicModule with factory', () => {
      const result = MessagingModule.forRootAsync({
        useFactory: () => ({
          consumerGroup: 'test',
          topics: ['test-topic'],
        }),
      });

      expect(result.module).toBe(MessagingModule);
      expect(result.global).toBe(true);
      expect(result.exports).toContain(MessagingService);
    });

    it('should pass inject tokens to options factory', () => {
      const TOKEN = 'CUSTOM_TOKEN';
      const result = MessagingModule.forRootAsync({
        useFactory: () => ({ consumerGroup: 'test' }),
        inject: [TOKEN],
      });

      const optionsProvider = result.providers?.find(
        (p) =>
          typeof p === 'object' &&
          'provide' in p &&
          p.provide === MESSAGING_OPTIONS_TOKEN,
      );
      expect(optionsProvider).toBeDefined();
      expect((optionsProvider as { inject: unknown[] }).inject).toContain(
        TOKEN,
      );
    });
  });
});
