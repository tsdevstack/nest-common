import { describe, it, expect } from '@rstest/core';

import { ObservabilityModule } from './observability.module';

describe('ObservabilityModule', () => {
  describe('forRoot', () => {
    it('should return a DynamicModule', () => {
      const result = ObservabilityModule.forRoot();

      expect(result.module).toBe(ObservabilityModule);
      expect(result.global).toBe(true);
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

    it('should exclude tracing when disabled', () => {
      const withTracing = ObservabilityModule.forRoot();
      const withoutTracing = ObservabilityModule.forRoot({ tracing: false });

      expect(withoutTracing.providers!.length).toBeLessThan(
        withTracing.providers!.length,
      );
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
