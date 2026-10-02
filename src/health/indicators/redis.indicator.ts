import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { REDIS_HEALTH_PING_TIMEOUT_MS } from '../../redis/redis.constants';
import type { HealthIndicatorResult } from '../health.interface';

@Injectable()
export class RedisHealthIndicator {
  constructor(private readonly redisService: RedisService) {}

  /**
   * Reports Redis as down when the client is not ready (connecting,
   * reconnecting, closed) or does not answer PING in time.
   */
  async check(): Promise<HealthIndicatorResult> {
    const client = this.redisService.getClient();

    if (!client || client.status !== 'ready') {
      return {
        status: 'down',
        details: {
          error: 'Redis connection not ready',
          connection: client?.status ?? 'uninitialized',
        },
      };
    }

    try {
      await this.pingWithTimeout(() => client.ping());
      return { status: 'up' };
    } catch {
      return {
        status: 'down',
        details: { error: 'Redis connection failed' },
      };
    }
  }

  private async pingWithTimeout(ping: () => Promise<string>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Redis PING timed out')),
        REDIS_HEALTH_PING_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([ping(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
