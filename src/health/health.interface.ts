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
   * Redis health indicator. Default: on when the app imports RedisModule.
   * `false` turns it off. The result is reported in the body only: `/health`
   * answers 200 either way (status `degraded` when Redis is down), so probes
   * never restart an instance because of Redis.
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
