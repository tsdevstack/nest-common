import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

// Use rs.hoisted() to define ALL mocks that are used in rs.mock() factories
const {
  mockMeterProvider,
  mockTracerProvider,
  mockMeter,
  mockTracer,
  MockPrometheusExporter,
  MockMeterProvider,
  MockNodeTracerProvider,
} = rs.hoisted(() => {
  const meterProvider = {
    shutdown: rs.fn().mockResolvedValue(undefined),
  };
  const tracerProvider = {
    register: rs.fn(),
    shutdown: rs.fn().mockResolvedValue(undefined),
  };
  const prometheusExporterInstance = {};
  const meter = {
    createCounter: rs.fn(),
    createHistogram: rs.fn(),
  };
  const tracer = {
    startSpan: rs.fn(),
  };

  // Use class syntax for proper constructor behavior
  class PrometheusExporterMock {
    constructor() {
      Object.assign(this, prometheusExporterInstance);
    }
  }

  class MeterProviderMock {
    shutdown = meterProvider.shutdown;
  }

  class NodeTracerProviderMock {
    register = tracerProvider.register;
    shutdown = tracerProvider.shutdown;
  }

  return {
    mockMeterProvider: meterProvider,
    mockTracerProvider: tracerProvider,
    mockMeter: meter,
    mockTracer: tracer,
    MockPrometheusExporter: PrometheusExporterMock,
    MockMeterProvider: MeterProviderMock,
    MockNodeTracerProvider: NodeTracerProviderMock,
  };
});

rs.mock('@opentelemetry/exporter-prometheus', () => ({
  PrometheusExporter: MockPrometheusExporter,
}));

rs.mock('@opentelemetry/sdk-metrics', () => ({
  MeterProvider: MockMeterProvider,
}));

rs.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: MockNodeTracerProvider,
  BatchSpanProcessor: class {},
}));

rs.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {},
}));

rs.mock('@opentelemetry/resources', () => ({
  Resource: class {},
}));

rs.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
}));

rs.mock('@opentelemetry/api', () => ({
  metrics: {
    setGlobalMeterProvider: rs.fn(),
    getMeter: rs.fn().mockReturnValue(mockMeter),
  },
  trace: {
    getTracer: rs.fn().mockReturnValue(mockTracer),
  },
}));

import { TelemetryService } from './telemetry.service';

describe('TelemetryService', () => {
  let service: TelemetryService;
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should use options.serviceName when provided', () => {
      service = new TelemetryService({ serviceName: 'test-service' });
      expect(service.getServiceName()).toBe('test-service');
    });

    it('should fall back to SERVICE_NAME env var', () => {
      process.env.SERVICE_NAME = 'env-service';
      service = new TelemetryService({});
      expect(service.getServiceName()).toBe('env-service');
    });

    it('should default to unknown-service when no name provided', () => {
      delete process.env.SERVICE_NAME;
      service = new TelemetryService({});
      expect(service.getServiceName()).toBe('unknown-service');
    });

    it('should enable metrics by default', () => {
      service = new TelemetryService({});
      // Metrics are enabled by default, so onModuleInit should initialize them
      service.onModuleInit();
      // Verify prometheus exporter was initialized
      expect(service.getPrometheusExporter()).not.toBeNull();
    });

    it('should enable tracing by default', () => {
      service = new TelemetryService({});
      expect(service.isTracingEnabled()).toBe(true);
    });

    it('should disable metrics when explicitly set', () => {
      service = new TelemetryService({ metrics: false });
      service.onModuleInit();
      // Verify prometheus exporter was not initialized
      expect(service.getPrometheusExporter()).toBeNull();
    });

    it('should disable tracing when explicitly set', () => {
      service = new TelemetryService({ tracing: false });
      expect(service.isTracingEnabled()).toBe(false);
    });

    it('should use custom tracing endpoint when provided', () => {
      service = new TelemetryService({
        tracingEndpoint: 'http://custom:4318',
      });
      // Endpoint is stored internally - we verify by checking the service initializes without error
      expect(service.isTracingEnabled()).toBe(true);
    });

    it('should use OTEL_EXPORTER_OTLP_ENDPOINT env var for tracing endpoint', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318';
      service = new TelemetryService({});
      // Endpoint is used during initialization
      expect(service.isTracingEnabled()).toBe(true);
    });
  });

  describe('onModuleInit', () => {
    it('should initialize metrics when enabled', () => {
      service = new TelemetryService({ metrics: true, tracing: false });
      service.onModuleInit();
      // Verify prometheus exporter was initialized
      expect(service.getPrometheusExporter()).not.toBeNull();
    });

    it('should initialize tracing when enabled', () => {
      service = new TelemetryService({ metrics: false, tracing: true });
      service.onModuleInit();
      expect(mockTracerProvider.register).toHaveBeenCalled();
    });

    it('should initialize both metrics and tracing by default', () => {
      service = new TelemetryService({});
      service.onModuleInit();
      // Verify prometheus exporter was initialized
      expect(service.getPrometheusExporter()).not.toBeNull();
      expect(mockTracerProvider.register).toHaveBeenCalled();
    });

    it('should not initialize metrics when disabled', () => {
      service = new TelemetryService({ metrics: false, tracing: false });
      service.onModuleInit();
      // Verify prometheus exporter was not initialized
      expect(service.getPrometheusExporter()).toBeNull();
    });

    it('should not initialize tracing when disabled', () => {
      service = new TelemetryService({ metrics: false, tracing: false });
      rs.clearAllMocks();
      service.onModuleInit();
      expect(mockTracerProvider.register).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should shutdown tracer provider when tracing enabled', async () => {
      service = new TelemetryService({ tracing: true, metrics: false });
      service.onModuleInit();
      await service.onModuleDestroy();
      expect(mockTracerProvider.shutdown).toHaveBeenCalled();
    });

    it('should shutdown meter provider when metrics enabled', async () => {
      service = new TelemetryService({ metrics: true, tracing: false });
      service.onModuleInit();
      await service.onModuleDestroy();
      expect(mockMeterProvider.shutdown).toHaveBeenCalled();
    });

    it('should handle shutdown gracefully when nothing initialized', async () => {
      service = new TelemetryService({ metrics: false, tracing: false });
      service.onModuleInit();
      // Should not throw
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('getMeter', () => {
    it('should return a meter with default service name', () => {
      service = new TelemetryService({ serviceName: 'my-service' });
      const meter = service.getMeter();
      expect(meter).toBe(mockMeter);
    });

    it('should return a meter with custom name', () => {
      service = new TelemetryService({});
      const meter = service.getMeter('custom-meter');
      expect(meter).toBe(mockMeter);
    });
  });

  describe('getTracer', () => {
    it('should return a tracer with default service name', () => {
      service = new TelemetryService({ serviceName: 'my-service' });
      const tracer = service.getTracer();
      expect(tracer).toBe(mockTracer);
    });

    it('should return a tracer with custom name', () => {
      service = new TelemetryService({});
      const tracer = service.getTracer('custom-tracer');
      expect(tracer).toBe(mockTracer);
    });
  });

  describe('getServiceName', () => {
    it('should return the configured service name', () => {
      service = new TelemetryService({ serviceName: 'configured-service' });
      expect(service.getServiceName()).toBe('configured-service');
    });
  });

  describe('isTracingEnabled', () => {
    it('should return true when tracing is enabled', () => {
      service = new TelemetryService({ tracing: true });
      expect(service.isTracingEnabled()).toBe(true);
    });

    it('should return false when tracing is disabled', () => {
      service = new TelemetryService({ tracing: false });
      expect(service.isTracingEnabled()).toBe(false);
    });
  });

  describe('getPrometheusExporter', () => {
    it('should return null before initialization', () => {
      service = new TelemetryService({});
      expect(service.getPrometheusExporter()).toBeNull();
    });

    it('should return exporter after initialization', () => {
      service = new TelemetryService({ metrics: true });
      service.onModuleInit();
      expect(service.getPrometheusExporter()).not.toBeNull();
    });

    it('should return null when metrics disabled', () => {
      service = new TelemetryService({ metrics: false });
      service.onModuleInit();
      expect(service.getPrometheusExporter()).toBeNull();
    });
  });
});
