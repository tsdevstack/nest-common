import { Module, DynamicModule, Global, type Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from '../logging/logger.module';
import { LoggingInterceptor } from '../logging/logging.interceptor';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { TracingInterceptor } from '../telemetry/tracing.interceptor';
import { MetricsModule } from '../metrics/metrics.module';
import { MetricsInterceptor } from '../metrics/metrics.interceptor';
import { HealthModule } from '../health/health.module';
import type { ObservabilityModuleOptions } from './observability.interface';

/**
 * Unified observability module that provides logging, metrics, tracing, and health.
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [ObservabilityModule],
 * })
 * export class AppModule {}
 * ```
 *
 * Or with options:
 * ```typescript
 * @Module({
 *   imports: [ObservabilityModule.forRoot({ tracing: false })],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({
  imports: [LoggerModule, TelemetryModule, MetricsModule, HealthModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [LoggerModule, TelemetryModule, MetricsModule],
})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    const imports: DynamicModule['imports'] = [];
    const providers: Provider[] = [];
    const exports: DynamicModule['exports'] = [];

    // Logging (default: enabled)
    if (options.logging !== false) {
      imports.push(LoggerModule);
      exports.push(LoggerModule);
      providers.push({
        provide: APP_INTERCEPTOR,
        useClass: LoggingInterceptor,
      });
    }

    // Telemetry & Metrics (default: enabled)
    if (options.metrics !== false || options.tracing !== false) {
      imports.push(
        TelemetryModule.forRoot({
          serviceName: options.serviceName,
          metrics: options.metrics,
          tracing: options.tracing,
          tracingEndpoint: options.tracingEndpoint,
        })
      );
      exports.push(TelemetryModule);
    }

    if (options.metrics !== false) {
      imports.push(MetricsModule);
      exports.push(MetricsModule);
      providers.push({
        provide: APP_INTERCEPTOR,
        useClass: MetricsInterceptor,
      });
    }

    if (options.tracing !== false) {
      providers.push({
        provide: APP_INTERCEPTOR,
        useClass: TracingInterceptor,
      });
    }

    // Health (default: enabled)
    if (options.health !== false) {
      imports.push(HealthModule);
    }

    return {
      module: ObservabilityModule,
      global: true,
      imports,
      providers,
      exports,
    };
  }
}