import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { SecretsService } from '../secrets/secrets.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redis!: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly secrets: SecretsService) {}

  async onModuleInit(): Promise<void> {
    try {
      // Load Redis configuration from secrets
      const host = await this.secrets.get('REDIS_HOST');
      const port = parseInt(await this.secrets.get('REDIS_PORT'), 10) || 6379;
      const password = await this.secrets.get('REDIS_PASSWORD');
      const redisTls = await this.secrets.get('REDIS_TLS');

      // Create Redis connection
      this.redis = new Redis({
        host,
        port,
        password,
        // AWS ElastiCache requires TLS when transit_encryption_enabled = true
        ...(redisTls === 'true' && { tls: {} }),

        // Connection pooling settings (CRITICAL for serverless)
        // Note: ioredis uses a single persistent connection per instance
        // "Pooling" means limiting service instances, not connections per instance
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        enableOfflineQueue: false,

        // Reuse connections (optimize for container/serverless)
        lazyConnect: true,
        keepAlive: 30000, // 30 seconds

        // Connection timeout and retry
        connectTimeout: 10000,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.error('Max connection retries exceeded');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.redis.on('connect', () => {
        this.logger.log('Connected to Redis');
      });

      this.redis.on('error', (error) => {
        this.logger.error('Redis connection error:', error);
      });

      // Connect to Redis
      await this.redis.connect();
    } catch (error) {
      this.logger.error(
        'Failed to connect to Redis on startup',
        error as Error,
      );
      throw error;
    }
  }

  getClient(): Redis {
    return this.redis;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error(`Error getting key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
      return true;
    } catch (error) {
      this.logger.error(`Error setting key ${key}:`, error);
      return false;
    }
  }

  async incr(key: string): Promise<number | null> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Error incrementing key ${key}:`, error);
      return null;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, seconds);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error setting expiry for key ${key}:`, error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      const result = await this.redis.del(key);
      return result > 0;
    } catch (error) {
      this.logger.error(`Error deleting key ${key}:`, error);
      return false;
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
