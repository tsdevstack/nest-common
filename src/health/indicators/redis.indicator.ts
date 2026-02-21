import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import type { HealthIndicatorResult } from '../health.interface';

@Injectable()
export class RedisHealthIndicator {
  constructor(private readonly redisService: RedisService) {}

  async check(): Promise<HealthIndicatorResult> {
    try {
      await this.redisService.get('health-check');
      return { status: 'up' };
    } catch {
      return {
        status: 'down',
        details: { error: 'Redis connection failed' },
      };
    }
  }
}