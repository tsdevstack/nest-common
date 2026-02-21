import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockRedisInstance, MockRedis } = rs.hoisted(() => {
  const instance = {
    on: rs.fn().mockReturnThis(),
    connect: rs.fn().mockResolvedValue(undefined),
    disconnect: rs.fn(),
    get: rs.fn(),
    set: rs.fn(),
    setex: rs.fn(),
    incr: rs.fn(),
    expire: rs.fn(),
    del: rs.fn(),
  };
  return {
    mockRedisInstance: instance,
    MockRedis: rs.fn().mockImplementation(() => instance),
  };
});

rs.mock('ioredis', () => ({
  default: MockRedis,
}));

rs.mock('@nestjs/common', () => ({
  Injectable: () => (target: unknown) => target,
  Logger: class {
    log = rs.fn();
    error = rs.fn();
  },
}));

import { RedisService } from './redis.service';
import type { SecretsService } from '../secrets/secrets.service';

describe('RedisService', () => {
  let service: RedisService;
  let mockSecrets: Partial<SecretsService>;

  beforeEach(() => {
    rs.clearAllMocks();

    mockSecrets = {
      get: rs.fn().mockImplementation((key: string) => {
        const secrets: Record<string, string> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: '6379',
          REDIS_PASSWORD: 'pass',
          REDIS_TLS: 'false',
        };
        return Promise.resolve(secrets[key] || '');
      }),
    };

    service = new RedisService(mockSecrets as SecretsService);
  });

  describe('onModuleInit', () => {
    it('should create Redis connection with secrets', async () => {
      await service.onModuleInit();

      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          password: 'pass',
        }),
      );
    });

    it('should enable TLS when REDIS_TLS is true', async () => {
      rs.mocked(mockSecrets.get!).mockImplementation((key: string) => {
        if (key === 'REDIS_TLS') return Promise.resolve('true');
        return Promise.resolve('val');
      });

      await service.onModuleInit();

      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({ tls: {} }),
      );
    });

    it('should call redis.connect()', async () => {
      await service.onModuleInit();
      expect(mockRedisInstance.connect).toHaveBeenCalled();
    });

    it('should throw if connection fails', async () => {
      mockRedisInstance.connect.mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      await expect(service.onModuleInit()).rejects.toThrow(
        'Connection refused',
      );
    });
  });

  describe('getClient', () => {
    it('should return redis instance', async () => {
      await service.onModuleInit();
      expect(service.getClient()).toBe(mockRedisInstance);
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return value from redis', async () => {
      mockRedisInstance.get.mockResolvedValue('cached-value');

      const result = await service.get('key');
      expect(result).toBe('cached-value');
    });

    it('should return null on error', async () => {
      mockRedisInstance.get.mockRejectedValue(new Error('fail'));

      const result = await service.get('key');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should call redis.set without TTL', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');

      const result = await service.set('key', 'value');

      expect(mockRedisInstance.set).toHaveBeenCalledWith('key', 'value');
      expect(result).toBe(true);
    });

    it('should call redis.setex with TTL', async () => {
      mockRedisInstance.setex.mockResolvedValue('OK');

      const result = await service.set('key', 'value', 60);

      expect(mockRedisInstance.setex).toHaveBeenCalledWith('key', 60, 'value');
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockRedisInstance.set.mockRejectedValue(new Error('fail'));

      const result = await service.set('key', 'value');
      expect(result).toBe(false);
    });
  });

  describe('incr', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return incremented value', async () => {
      mockRedisInstance.incr.mockResolvedValue(5);

      const result = await service.incr('counter');
      expect(result).toBe(5);
    });

    it('should return null on error', async () => {
      mockRedisInstance.incr.mockRejectedValue(new Error('fail'));

      const result = await service.incr('counter');
      expect(result).toBeNull();
    });
  });

  describe('expire', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return true when expiry set successfully', async () => {
      mockRedisInstance.expire.mockResolvedValue(1);

      const result = await service.expire('key', 60);
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockRedisInstance.expire.mockResolvedValue(0);

      const result = await service.expire('key', 60);
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockRedisInstance.expire.mockRejectedValue(new Error('fail'));

      const result = await service.expire('key', 60);
      expect(result).toBe(false);
    });
  });

  describe('del', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return true when key deleted', async () => {
      mockRedisInstance.del.mockResolvedValue(1);

      const result = await service.del('key');
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockRedisInstance.del.mockResolvedValue(0);

      const result = await service.del('key');
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockRedisInstance.del.mockRejectedValue(new Error('fail'));

      const result = await service.del('key');
      expect(result).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect from redis', async () => {
      await service.onModuleInit();
      service.onModuleDestroy();
      expect(mockRedisInstance.disconnect).toHaveBeenCalled();
    });
  });
});
