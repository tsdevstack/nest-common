import { Injectable, Optional, Inject, OnModuleInit } from '@nestjs/common';
import type { HealthCheckResult, HealthModuleOptions } from './health.interface';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { MemoryHealthIndicator } from './indicators/memory.indicator';

@Injectable()
export class HealthService implements OnModuleInit {
  constructor(
    @Inject('HEALTH_MODULE_OPTIONS') private readonly options: HealthModuleOptions,
    @Optional() private readonly redisIndicator?: RedisHealthIndicator,
    @Optional() private readonly memoryIndicator?: MemoryHealthIndicator,
  ) {}

  onModuleInit(): void {
    if (this.options.memory?.heapThreshold && this.memoryIndicator) {
      this.memoryIndicator.setThreshold(this.options.memory.heapThreshold);
    }
  }

  async check(): Promise<HealthCheckResult> {
    const checks: Record<string, { status: 'up' | 'down'; details?: Record<string, unknown> }> = {};
    let overallStatus: 'ok' | 'degraded' | 'down' = 'ok';

    // Redis check
    if (this.options.redis && this.redisIndicator) {
      const redisResult = await this.redisIndicator.check();
      checks.redis = redisResult;
      if (redisResult.status === 'down') {
        overallStatus = 'degraded';
      }
    }

    // Memory check
    if (this.options.memory && this.memoryIndicator) {
      const memoryResult = this.memoryIndicator.check();
      checks.memory = memoryResult;
      if (memoryResult.status === 'down') {
        overallStatus = 'degraded';
      }
    }

    const memoryUsage = process.memoryUsage();

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
    };
  }
}