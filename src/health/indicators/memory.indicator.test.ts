import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { MemoryHealthIndicator } from './memory.indicator';

describe('MemoryHealthIndicator', () => {
  let indicator: MemoryHealthIndicator;
  const originalMemoryUsage = process.memoryUsage;

  beforeEach(() => {
    indicator = new MemoryHealthIndicator();
  });

  afterEach(() => {
    process.memoryUsage = originalMemoryUsage;
  });

  const mockMemoryUsage = (heapUsed: number, heapTotal: number) => {
    const mockFn = rs.fn().mockReturnValue({
      heapUsed,
      heapTotal,
      external: 0,
      arrayBuffers: 0,
      rss: 0,
    }) as unknown as typeof process.memoryUsage;
    // Add the rss method that the type requires
    mockFn.rss = rs.fn().mockReturnValue(0);
    process.memoryUsage = mockFn;
  };

  describe('check', () => {
    it('should return up status when memory is within threshold', () => {
      mockMemoryUsage(100 * 1024 * 1024, 200 * 1024 * 1024);

      const result = indicator.check();

      expect(result.status).toBe('up');
      expect(result.details).toEqual({
        heapUsed: 100,
        heapTotal: 200,
        unit: 'MB',
      });
    });

    it('should return down status when memory exceeds threshold', () => {
      indicator.setThreshold(100 * 1024 * 1024); // 100MB threshold
      mockMemoryUsage(150 * 1024 * 1024, 200 * 1024 * 1024);

      const result = indicator.check();

      expect(result.status).toBe('down');
      expect(result.details).toEqual({
        heapUsed: 150,
        heapThreshold: 100,
        unit: 'MB',
      });
    });
  });

  describe('setThreshold', () => {
    it('should update the threshold', () => {
      mockMemoryUsage(80 * 1024 * 1024, 200 * 1024 * 1024);

      // Default threshold is 500MB, so 80MB should be up
      expect(indicator.check().status).toBe('up');

      // Set threshold to 50MB
      indicator.setThreshold(50 * 1024 * 1024);

      // Now 80MB should be down
      expect(indicator.check().status).toBe('down');
    });
  });
});
