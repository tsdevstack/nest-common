export interface HealthIndicatorResult {
  status: 'up' | 'down';
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  checks: Record<string, HealthIndicatorResult>;
  memory: {
    used: number;
    total: number;
  };
}

export interface HealthModuleOptions {
  /**
   * Enable Redis health indicator
   * Requires RedisModule to be imported
   */
  redis?: boolean;

  /**
   * Memory health indicator options
   */
  memory?: {
    /**
     * Heap threshold in bytes. If exceeded, status becomes 'degraded'
     * Default: 500MB (500 * 1024 * 1024)
     */
    heapThreshold?: number;
  };
}