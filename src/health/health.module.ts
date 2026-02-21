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

    // Only include Redis indicator if redis option is enabled
    if (options.redis) {
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