import { Module, DynamicModule, Global } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import type { TelemetryModuleOptions } from './telemetry.interface';

@Global()
@Module({
  providers: [
    {
      provide: 'TELEMETRY_MODULE_OPTIONS',
      useValue: {},
    },
    TelemetryService,
  ],
  exports: [TelemetryService],
})
export class TelemetryModule {
  static forRoot(options: TelemetryModuleOptions = {}): DynamicModule {
    return {
      module: TelemetryModule,
      global: true,
      providers: [
        {
          provide: 'TELEMETRY_MODULE_OPTIONS',
          useValue: options,
        },
        TelemetryService,
      ],
      exports: [TelemetryService],
    };
  }
}