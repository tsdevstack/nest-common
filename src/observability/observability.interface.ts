export interface ObservabilityModuleOptions {
  /**
   * Enable logging
   * Default: true
   */
  logging?: boolean;

  /**
   * Enable metrics collection
   * Default: true
   */
  metrics?: boolean;

  /**
   * Enable distributed tracing
   * Default: true
   */
  tracing?: boolean;

  /**
   * Enable health endpoints
   * Default: true
   */
  health?: boolean;

  /**
   * OTLP base endpoint for tracing (Jaeger, OTEL Collector, etc.)
   * Default: OTEL_EXPORTER_OTLP_ENDPOINT env var or 'http://localhost:4318'
   */
  tracingEndpoint?: string;

  /**
   * Service name for telemetry identification
   * Default: SERVICE_NAME env var
   */
  serviceName?: string;
}