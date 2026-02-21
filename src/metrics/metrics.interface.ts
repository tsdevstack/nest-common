export interface MetricsModuleOptions {
  /**
   * Path to expose metrics endpoint
   * Default: '/metrics'
   */
  path?: string;

  /**
   * Prefix for all metrics
   * Default: service name from SERVICE_NAME env var
   */
  prefix?: string;

  /**
   * Enable default Node.js metrics (memory, CPU, event loop lag)
   * Default: true
   */
  defaultMetrics?: boolean;
}