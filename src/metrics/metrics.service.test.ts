import { describe, it, expect, beforeEach, rs } from '@rstest/core';

// Mock the OpenTelemetry API
const mockMeter = {
  createHistogram: rs.fn().mockReturnValue({
    record: rs.fn(),
  }),
  createCounter: rs.fn().mockReturnValue({
    add: rs.fn(),
  }),
  createUpDownCounter: rs.fn().mockReturnValue({
    add: rs.fn(),
  }),
};

const mockTelemetryService = {
  getMeter: rs.fn().mockReturnValue(mockMeter),
  getPrometheusExporter: rs.fn().mockReturnValue(null),
};

import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    rs.clearAllMocks();
    metricsService = new MetricsService(
      { prefix: 'test' },
      mockTelemetryService as never,
    );
  });

  describe('onModuleInit', () => {
    it('should create HTTP metrics when telemetry service is available', () => {
      metricsService.onModuleInit();

      expect(mockTelemetryService.getMeter).toHaveBeenCalled();
      expect(mockMeter.createHistogram).toHaveBeenCalledWith(
        'test_http_request_duration_seconds',
        expect.objectContaining({
          description: 'Duration of HTTP requests in seconds',
        }),
      );
      expect(mockMeter.createCounter).toHaveBeenCalledWith(
        'test_http_requests_total',
        expect.objectContaining({
          description: 'Total number of HTTP requests',
        }),
      );
      expect(mockMeter.createUpDownCounter).toHaveBeenCalledWith(
        'test_http_active_connections',
        expect.objectContaining({
          description: 'Number of active HTTP connections',
        }),
      );
    });

    it('should warn when telemetry service is not available', () => {
      const consoleWarn = rs
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const serviceWithoutTelemetry = new MetricsService({ prefix: 'test' });
      serviceWithoutTelemetry.onModuleInit();

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('TelemetryService not available'),
      );
      consoleWarn.mockRestore();
    });
  });

  describe('recordHttpRequestDuration', () => {
    it('should record duration with labels', () => {
      metricsService.onModuleInit();
      const mockRecord = rs.fn();
      (mockMeter.createHistogram as ReturnType<typeof rs.fn>).mockReturnValue({
        record: mockRecord,
      });
      metricsService.onModuleInit(); // Re-init to get new mock

      metricsService.recordHttpRequestDuration(
        { method: 'GET', route: '/test', status_code: '200' },
        0.5,
      );

      expect(mockRecord).toHaveBeenCalledWith(0.5, {
        method: 'GET',
        route: '/test',
        status_code: '200',
      });
    });
  });

  describe('incrementHttpRequestTotal', () => {
    it('should increment counter with labels', () => {
      metricsService.onModuleInit();
      const mockAdd = rs.fn();
      (mockMeter.createCounter as ReturnType<typeof rs.fn>).mockReturnValue({
        add: mockAdd,
      });
      metricsService.onModuleInit(); // Re-init to get new mock

      metricsService.incrementHttpRequestTotal({
        method: 'GET',
        route: '/test',
        status_code: '200',
      });

      expect(mockAdd).toHaveBeenCalledWith(1, {
        method: 'GET',
        route: '/test',
        status_code: '200',
      });
    });
  });

  describe('active connections', () => {
    it('should increment active connections', () => {
      const mockAdd = rs.fn();
      (
        mockMeter.createUpDownCounter as ReturnType<typeof rs.fn>
      ).mockReturnValue({
        add: mockAdd,
      });
      metricsService.onModuleInit();

      metricsService.incrementActiveConnections();

      expect(mockAdd).toHaveBeenCalledWith(1);
    });

    it('should decrement active connections', () => {
      const mockAdd = rs.fn();
      (
        mockMeter.createUpDownCounter as ReturnType<typeof rs.fn>
      ).mockReturnValue({
        add: mockAdd,
      });
      metricsService.onModuleInit();

      metricsService.decrementActiveConnections();

      expect(mockAdd).toHaveBeenCalledWith(-1);
    });
  });

  describe('custom metrics', () => {
    it('should create custom counter', () => {
      metricsService.onModuleInit();
      const counter = metricsService.createCounter('custom_counter', {
        description: 'A custom counter',
      });

      expect(counter).toBeDefined();
      expect(mockMeter.createCounter).toHaveBeenCalledWith('custom_counter', {
        description: 'A custom counter',
      });
    });

    it('should create custom histogram', () => {
      metricsService.onModuleInit();
      const histogram = metricsService.createHistogram('custom_histogram', {
        description: 'A custom histogram',
      });

      expect(histogram).toBeDefined();
      expect(mockMeter.createHistogram).toHaveBeenCalledWith(
        'custom_histogram',
        {
          description: 'A custom histogram',
        },
      );
    });

    it('should create custom up/down counter', () => {
      metricsService.onModuleInit();
      const gauge = metricsService.createUpDownCounter('custom_gauge', {
        description: 'A custom gauge',
      });

      expect(gauge).toBeDefined();
      expect(mockMeter.createUpDownCounter).toHaveBeenCalledWith(
        'custom_gauge',
        {
          description: 'A custom gauge',
        },
      );
    });

    it('should return undefined when meter not available', () => {
      const serviceWithoutTelemetry = new MetricsService({ prefix: 'test' });
      const counter = serviceWithoutTelemetry.createCounter('test');

      expect(counter).toBeUndefined();
    });
  });

  describe('getContentType', () => {
    it('should return plain text content type', () => {
      const contentType = metricsService.getContentType();
      expect(contentType).toBe('text/plain; charset=utf-8');
    });
  });

  describe('getTelemetryService', () => {
    it('should return the telemetry service', () => {
      const telemetry = metricsService.getTelemetryService();
      expect(telemetry).toBe(mockTelemetryService);
    });
  });
});
