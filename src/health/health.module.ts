import { Module, DynamicModule, type Provider, Global } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { MemoryHealthIndicator } from './indicators/memory.indicator';
import type { HealthModuleOptions } from './health.interface';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    MemoryHealthIndicator,
    RedisHealthIndicator,
    {
      provide: 'HEALTH_MODULE_OPTIONS',
      useValue: {},
    },
  ],
  exports: [HealthService],
})
export class HealthModule {
  static forRoot(options: HealthModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [HealthService, MemoryHealthIndicator];

    // Redis is checked when the app has Redis, unless `redis: false`
    if (options.redis !== false) {
      providers.push(RedisHealthIndicator);
    }

    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        ...providers,
        {
          provide: 'HEALTH_MODULE_OPTIONS',
          useValue: options,
        },
      ],
      exports: [HealthService],
    };
  }
}
