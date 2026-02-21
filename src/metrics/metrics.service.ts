import { Injectable, OnModuleInit, Inject, Optional } from '@nestjs/common';
import {
  type Counter,
  type Histogram,
  type UpDownCounter,
  type Meter,
} from '@opentelemetry/api';
import { TelemetryService } from '../telemetry/telemetry.service';
import type { MetricsModuleOptions } from './metrics.interface';

@Injectable()
export class MetricsService implements OnModuleInit {
  private meter!: Meter;
  private prefix: string;

  // Default HTTP metrics
  private _httpRequestDuration!: Histogram;
  private _httpRequestTotal!: Counter;
  private _httpActiveConnections!: UpDownCounter;

  constructor(
    @Inject('METRICS_MODULE_OPTIONS')
    options: MetricsModuleOptions,
    @Optional() private readonly telemetryService?: TelemetryService,
  ) {
    // Sanitize prefix: metric names use underscores
    const rawPrefix = options.prefix || process.env.SERVICE_NAME || '';
    this.prefix = rawPrefix.replace(/-/g, '_');
  }

  onModuleInit(): void {
    if (!this.telemetryService) {
      console.warn(
        'MetricsService: TelemetryService not available. Import TelemetryModule before MetricsModule.',
      );
      return;
    }

    // Get meter from telemetry service
    this.meter = this.telemetryService.getMeter();

    // HTTP request duration histogram
    this._httpRequestDuration = this.meter.createHistogram(
      this.prefix ? `${this.prefix}_http_request_duration_seconds` : 'http_request_duration_seconds',
      {
        description: 'Duration of HTTP requests in seconds',
        unit: 's',
      },
    );

    // HTTP request counter
    this._httpRequestTotal = this.meter.createCounter(
      this.prefix ? `${this.prefix}_http_requests_total` : 'http_requests_total',
      {
        description: 'Total number of HTTP requests',
      },
    );

    // Active connections gauge (using UpDownCounter in OTEL)
    this._httpActiveConnections = this.meter.createUpDownCounter(
      this.prefix ? `${this.prefix}_http_active_connections` : 'http_active_connections',
      {
        description: 'Number of active HTTP connections',
      },
    );
  }

  /**
   * Record HTTP request duration
   */
  recordHttpRequestDuration(
    labels: { method: string; route: string; status_code: string },
    duration: number,
  ): void {
    if (this._httpRequestDuration) {
      this._httpRequestDuration.record(duration, labels);
    }
  }

  /**
   * Increment HTTP request total
   */
  incrementHttpRequestTotal(labels: {
    method: string;
    route: string;
    status_code: string;
  }): void {
    if (this._httpRequestTotal) {
      this._httpRequestTotal.add(1, labels);
    }
  }

  /**
   * Increment active connections
   */
  incrementActiveConnections(): void {
    if (this._httpActiveConnections) {
      this._httpActiveConnections.add(1);
    }
  }

  /**
   * Decrement active connections
   */
  decrementActiveConnections(): void {
    if (this._httpActiveConnections) {
      this._httpActiveConnections.add(-1);
    }
  }

  /**
   * Get the meter for creating custom metrics
   */
  getMeter(): Meter | undefined {
    return this.meter;
  }

  /**
   * Create a custom counter
   */
  createCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): Counter | undefined {
    if (!this.meter) return undefined;
    return this.meter.createCounter(name, options);
  }

  /**
   * Create a custom histogram
   */
  createHistogram(
    name: string,
    options?: { description?: string; unit?: string },
  ): Histogram | undefined {
    if (!this.meter) return undefined;
    return this.meter.createHistogram(name, options);
  }

  /**
   * Create a custom up/down counter (for gauge-like metrics)
   */
  createUpDownCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): UpDownCounter | undefined {
    if (!this.meter) return undefined;
    return this.meter.createUpDownCounter(name, options);
  }

  /**
   * Get metrics in Prometheus format (delegated to TelemetryService)
   */
  async getMetrics(): Promise<string> {
    if (!this.telemetryService) {
      return '# No telemetry service available\n';
    }
    const exporter = this.telemetryService.getPrometheusExporter();
    if (!exporter) {
      return '# No prometheus exporter available\n';
    }
    // The PrometheusExporter provides metrics via its internal server
    // We need to collect metrics differently
    return this.collectMetrics();
  }

  /**
   * Collect metrics in Prometheus format
   */
  private async collectMetrics(): Promise<string> {
    // For now, return a placeholder - the actual metrics endpoint
    // will be handled by the Prometheus exporter's HTTP handler
    return '# Metrics collected via OpenTelemetry Prometheus Exporter\n';
  }

  /**
   * Get content type for Prometheus metrics
   */
  getContentType(): string {
    return 'text/plain; charset=utf-8';
  }

  /**
   * Get the TelemetryService (for controller access to exporter)
   */
  getTelemetryService(): TelemetryService | undefined {
    return this.telemetryService;
  }
}