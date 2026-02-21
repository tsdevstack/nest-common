import { Module, DynamicModule, Global } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import type { MetricsModuleOptions } from './metrics.interface';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: 'METRICS_MODULE_OPTIONS',
      useValue: {},
    },
    MetricsService,
  ],
  exports: [MetricsService],
})
export class MetricsModule {
  static forRoot(options: MetricsModuleOptions = {}): DynamicModule {
    return {
      module: MetricsModule,
      global: true,
      controllers: [MetricsController],
      providers: [
        {
          provide: 'METRICS_MODULE_OPTIONS',
          useValue: options,
        },
        MetricsService,
      ],
      exports: [MetricsService],
    };
  }
}