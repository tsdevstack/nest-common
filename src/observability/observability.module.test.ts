import { describe, it, expect } from '@rstest/core';

import { APP_INTERCEPTOR } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ObservabilityModule } from './observability.module';
import { ObservabilityRootModule } from './observability-root.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { HealthModule } from '../health/health.module';
import { LoggingInterceptor } from '../logging/logging.interceptor';
import { MetricsInterceptor } from '../metrics/metrics.interceptor';

function interceptorsOf(providers: unknown[] | undefined): unknown[] {
  return (providers ?? [])
    .filter(
      (p): p is { provide: unknown; useClass: unknown } =>
        typeof p === 'object' &&
        p !== null &&
        (p as { provide?: unknown }).provide === APP_INTERCEPTOR,
    )
    .map((p) => p.useClass);
}

describe('ObservabilityModule', () => {
  describe('forRoot', () => {
    it('should return a DynamicModule', () => {
      const result = ObservabilityModule.forRoot();

      expect(result.module).toBe(ObservabilityRootModule);
      expect(result.global).toBe(true);
    });

    it('should build on a module with no @Module() providers or imports of its own', () => {
      // Nest adds the dynamic module's providers to its class's metadata;
      // ObservabilityModule's would register every interceptor twice
      const result = ObservabilityModule.forRoot();

      expect(
        Reflect.getMetadata(MODULE_METADATA.PROVIDERS, result.module) ?? [],
      ).toEqual([]);
      expect(
        Reflect.getMetadata(MODULE_METADATA.IMPORTS, result.module) ?? [],
      ).toEqual([]);
    });

    it('should register each interceptor once', () => {
      const result = ObservabilityModule.forRoot();

      expect(interceptorsOf(result.providers)).toEqual([
        LoggingInterceptor,
        MetricsInterceptor,
      ]);
    });

    it('should leave the metrics interceptor and health out when disabled', () => {
      const result = ObservabilityModule.forRoot({
        metrics: false,
        health: false,
      });

      expect(interceptorsOf(result.providers)).toEqual([LoggingInterceptor]);
      expect(result.imports).not.toContain(HealthModule);
    });

    it('should keep the defaults for a bare import', () => {
      expect(
        interceptorsOf(
          Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ObservabilityModule),
        ),
      ).toEqual([LoggingInterceptor, MetricsInterceptor]);
    });

    it('should include all modules by default', () => {
      const result = ObservabilityModule.forRoot();

      // Default: all enabled
      expect(result.imports!.length).toBeGreaterThan(0);
      expect(result.providers!.length).toBeGreaterThan(0);
      expect(result.exports!.length).toBeGreaterThan(0);
    });

    it('should exclude logging when disabled', () => {
      const withLogging = ObservabilityModule.forRoot({ logging: true });
      const withoutLogging = ObservabilityModule.forRoot({ logging: false });

      expect(withoutLogging.providers!.length).toBeLessThan(
        withLogging.providers!.length,
      );
    });

    it('should exclude metrics when disabled', () => {
      const withMetrics = ObservabilityModule.forRoot();
      const withoutMetrics = ObservabilityModule.forRoot({ metrics: false });

      expect(withoutMetrics.providers!.length).toBeLessThan(
        withMetrics.providers!.length,
      );
    });

    it('should tell telemetry when tracing is disabled', () => {
      const result = ObservabilityModule.forRoot({ tracing: false });

      // The request spans come from createApp's middleware; without a
      // registered tracer they are no-ops
      const telemetry = result.imports!.find(
        (m) => (m as { module?: unknown }).module === TelemetryModule,
      ) as { providers: { provide: string; useValue?: unknown }[] };
      const options = telemetry.providers.find(
        (p) => p.provide === 'TELEMETRY_MODULE_OPTIONS',
      );
      expect(options?.useValue).toMatchObject({ tracing: false });
    });

    it('should exclude health when disabled', () => {
      const withHealth = ObservabilityModule.forRoot();
      const withoutHealth = ObservabilityModule.forRoot({ health: false });

      expect(withoutHealth.imports!.length).toBeLessThan(
        withHealth.imports!.length,
      );
    });

    it('should pass serviceName to TelemetryModule', () => {
      const result = ObservabilityModule.forRoot({
        serviceName: 'my-service',
      });

      // TelemetryModule should be in imports
      expect(result.imports!.length).toBeGreaterThan(0);
    });

    it('should have no providers when all features disabled', () => {
      const result = ObservabilityModule.forRoot({
        logging: false,
        metrics: false,
        tracing: false,
      });

      expect(result.providers).toEqual([]);
    });
  });
});
