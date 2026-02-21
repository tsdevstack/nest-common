import { describe, it, expect, rs, beforeEach } from '@rstest/core';

import { HealthController } from './health.controller';
import type { HealthService } from './health.service';
import type { HealthCheckResult } from './health.interface';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthService: Partial<HealthService>;

  beforeEach(() => {
    rs.clearAllMocks();

    mockHealthService = {
      check: rs.fn(),
    };

    controller = new HealthController(mockHealthService as HealthService);
  });

  describe('healthCheck', () => {
    it('should return health check result from service', async () => {
      const expected: HealthCheckResult = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: 1000,
        checks: {
          memory: { status: 'up' },
        },
        memory: { used: 100000, total: 500000 },
      };

      rs.mocked(mockHealthService.check!).mockResolvedValue(expected);

      const result = await controller.healthCheck();

      expect(result).toEqual(expected);
      expect(mockHealthService.check).toHaveBeenCalledTimes(1);
    });
  });

  describe('ping', () => {
    it('should return pong message with timestamp', () => {
      const result = controller.ping();

      expect(result.message).toBe('pong');
      expect(typeof result.timestamp).toBe('string');
    });

    it('should return a valid ISO timestamp', () => {
      const result = controller.ping();
      const parsed = new Date(result.timestamp);

      expect(parsed.toISOString()).toBe(result.timestamp);
    });
  });
});
