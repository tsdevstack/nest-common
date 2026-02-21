import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { metrics, trace, type Meter, type Tracer } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { TelemetryModuleOptions } from './telemetry.interface';

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private meterProvider: MeterProvider | null = null;
  private prometheusExporter: PrometheusExporter | null = null;
  private tracerProvider: NodeTracerProvider | null = null;
  private readonly serviceName: string;
  private readonly serviceVersion: string;
  private readonly metricsEnabled: boolean;
  private readonly tracingEnabled: boolean;
  private readonly tracingEndpoint: string;

  constructor(
    @Inject('TELEMETRY_MODULE_OPTIONS')
    options: TelemetryModuleOptions,
  ) {
    this.serviceName = options.serviceName || process.env.SERVICE_NAME || 'unknown-service';
    this.serviceVersion = options.serviceVersion || '1.0.0';
    this.metricsEnabled = options.metrics !== false;
    this.tracingEnabled = options.tracing !== false;
    this.tracingEndpoint =
      options.tracingEndpoint ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      DEFAULT_OTLP_ENDPOINT;
  }

  onModuleInit(): void {
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: this.serviceName,
      [ATTR_SERVICE_VERSION]: this.serviceVersion,
    });

    if (this.metricsEnabled) {
      this.initializeMetrics(resource);
    }

    if (this.tracingEnabled) {
      this.initializeTracing(resource);
    }
  }

  private initializeMetrics(resource: Resource): void {
    // Create Prometheus exporter for /metrics endpoint
    // Note: We don't start a separate server - we'll use NestJS controller
    this.prometheusExporter = new PrometheusExporter({
      preventServerStart: true,
    });

    // Create meter provider with Prometheus exporter
    this.meterProvider = new MeterProvider({
      resource,
      readers: [this.prometheusExporter],
    });

    // Register as global meter provider
    metrics.setGlobalMeterProvider(this.meterProvider);
  }

  private initializeTracing(resource: Resource): void {
    // Create OTLP exporter for traces (Jaeger, OTEL Collector, etc.)
    const otlpExporter = new OTLPTraceExporter({
      url: `${this.tracingEndpoint}/v1/traces`,
    });

    // Create tracer provider with span processor
    this.tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(otlpExporter)],
    });

    // Register as global tracer provider
    this.tracerProvider.register();
  }

  async onModuleDestroy(): Promise<void> {
    const shutdownPromises: Promise<void>[] = [];

    if (this.tracerProvider) {
      shutdownPromises.push(this.tracerProvider.shutdown());
    }

    if (this.meterProvider) {
      shutdownPromises.push(this.meterProvider.shutdown());
    }

    await Promise.all(shutdownPromises);
  }

  /**
   * Get a meter for creating metrics
   */
  getMeter(name?: string): Meter {
    return metrics.getMeter(name || this.serviceName);
  }

  /**
   * Get a tracer for creating spans
   */
  getTracer(name?: string): Tracer {
    return trace.getTracer(name || this.serviceName);
  }

  /**
   * Get the service name
   */
  getServiceName(): string {
    return this.serviceName;
  }

  /**
   * Check if tracing is enabled
   */
  isTracingEnabled(): boolean {
    return this.tracingEnabled;
  }

  /**
   * Get the Prometheus exporter for custom handling
   */
  getPrometheusExporter(): PrometheusExporter | null {
    return this.prometheusExporter;
  }
}