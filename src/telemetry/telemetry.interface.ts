export interface TelemetryModuleOptions {
  /**
   * Service name for identification in telemetry
   * Default: SERVICE_NAME env var
   */
  serviceName?: string;

  /**
   * Service version
   * Default: '1.0.0'
   */
  serviceVersion?: string;

  /**
   * Enable metrics collection
   * Default: true
   */
  metrics?: boolean;

  /**
   * Enable tracing
   * Default: true
   */
  tracing?: boolean;

  /**
   * OTLP base endpoint (Jaeger, OTEL Collector, etc.)
   * The /v1/traces path is appended automatically.
   * Default: OTEL_EXPORTER_OTLP_ENDPOINT env var or 'http://localhost:4318'
   */
  tracingEndpoint?: string;

  /**
   * Port for Prometheus metrics endpoint (handled by OTEL exporter)
   * Default: uses existing /metrics controller
   */
  prometheusPort?: number;
}