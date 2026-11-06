import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  resourceFromAttributes,
  type Resource,
} from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { metrics, trace, type Meter, type Tracer } from '@opentelemetry/api';
import { registerTelemetry, type TelemetryHandle } from '@tsdevstack/telemetry';
import { LoggerService } from '../logging/logger.service';
import type { TelemetryModuleOptions } from './telemetry.interface';
import { registerPrismaTracing } from './register-prisma-tracing';

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private meterProvider: MeterProvider | null = null;
  private prometheusExporter: PrometheusExporter | null = null;
  private tracing: TelemetryHandle | null = null;
  private readonly serviceName: string;
  private readonly serviceVersion: string;
  private readonly metricsEnabled: boolean;
  private readonly tracingEnabled: boolean;
  private readonly tracingEndpoint?: string;

  constructor(
    @Inject('TELEMETRY_MODULE_OPTIONS')
    options: TelemetryModuleOptions,
  ) {
    // A worker's spans carry its own name (auth-worker), like its logs,
    // even when its module passes the base service's name
    this.serviceName =
      process.env.WORKER_NAME ||
      options.serviceName ||
      process.env.SERVICE_NAME ||
      'unknown-service';
    this.serviceVersion = options.serviceVersion || '1.0.0';
    this.metricsEnabled = options.metrics !== false;
    this.tracingEnabled = options.tracing !== false;
    this.tracingEndpoint = options.tracingEndpoint;
  }

  onModuleInit(): void {
    if (this.metricsEnabled) {
      this.initializeMetrics(
        resourceFromAttributes({
          [ATTR_SERVICE_NAME]: this.serviceName,
          [ATTR_SERVICE_VERSION]: this.serviceVersion,
        }),
      );
    }

    if (this.tracingEnabled) {
      // Traces go to the cloud's own service (SECRETS_PROVIDER: gcp, aws,
      // azure); locally to Jaeger
      const logger = new LoggerService();
      logger.setContext('Telemetry');
      this.tracing = registerTelemetry({
        serviceName: this.serviceName,
        serviceVersion: this.serviceVersion,
        provider: process.env.SECRETS_PROVIDER,
        endpoint: this.tracingEndpoint,
        onExportError: (message) => logger.warn(message),
      });
      registerPrismaTracing();
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

  async onModuleDestroy(): Promise<void> {
    const shutdownPromises: Promise<void>[] = [];

    if (this.tracing) {
      // A failed last export was already reported (onExportError); it must
      // not fail the shutdown
      shutdownPromises.push(this.tracing.shutdown().catch(() => undefined));
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
