import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { HealthService } from './health.service';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { MemoryHealthIndicator } from './indicators/memory.indicator';

describe('HealthService', () => {
  let healthService: HealthService;
  let mockRedisIndicator: RedisHealthIndicator;
  let mockMemoryIndicator: MemoryHealthIndicator;

  beforeEach(() => {
    mockRedisIndicator = {
      check: rs.fn(),
    } as unknown as RedisHealthIndicator;

    mockMemoryIndicator = {
      check: rs.fn(),
      setThreshold: rs.fn(),
    } as unknown as MemoryHealthIndicator;

    healthService = new HealthService(
      { redis: true, memory: { heapThreshold: 500 * 1024 * 1024 } },
      mockRedisIndicator,
      mockMemoryIndicator,
    );
    healthService.onModuleInit();
  });

  describe('check', () => {
    it('should return ok status when all checks pass', async () => {
      rs.mocked(mockRedisIndicator.check).mockResolvedValue({ status: 'up' });
      rs.mocked(mockMemoryIndicator.check).mockReturnValue({ status: 'up' });

      const result = await healthService.check();

      expect(result.status).toBe('ok');
      expect(result.checks.redis).toEqual({ status: 'up' });
      expect(result.checks.memory).toEqual({ status: 'up' });
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThan(0);
      expect(result.memory.used).toBeGreaterThan(0);
      expect(result.memory.total).toBeGreaterThan(0);
    });

    it('should return degraded status when redis is down', async () => {
      rs.mocked(mockRedisIndicator.check).mockResolvedValue({
        status: 'down',
        details: { error: 'Connection failed' },
      });
      rs.mocked(mockMemoryIndicator.check).mockReturnValue({ status: 'up' });

      const result = await healthService.check();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis.status).toBe('down');
    });

    it('should return degraded status when memory threshold exceeded', async () => {
      rs.mocked(mockRedisIndicator.check).mockResolvedValue({ status: 'up' });
      rs.mocked(mockMemoryIndicator.check).mockReturnValue({
        status: 'down',
        details: { heapUsed: 600, heapThreshold: 500, unit: 'MB' },
      });

      const result = await healthService.check();

      expect(result.status).toBe('degraded');
      expect(result.checks.memory.status).toBe('down');
    });

    it('should set memory threshold on init', () => {
      expect(mockMemoryIndicator.setThreshold).toHaveBeenCalledWith(
        500 * 1024 * 1024,
      );
    });
  });

  describe('without indicators', () => {
    it('should return ok status with no checks when no indicators configured', async () => {
      const minimalService = new HealthService({}, undefined, undefined);
      const result = await minimalService.check();

      expect(result.status).toBe('ok');
      expect(Object.keys(result.checks)).toHaveLength(0);
    });
  });
});
