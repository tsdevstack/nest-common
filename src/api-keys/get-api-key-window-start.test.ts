import { describe, it, expect } from '@rstest/core';
import { getApiKeyWindowStart } from './get-api-key-window-start';

// 2026-09-29T19:22:44Z (Tuesday, ISO week 2026-W40). Minute, hour, day and
// month values match kong.tools.timestamp.get_timestamps (divided by 1000).
const NOW = 1790709764;

describe('getApiKeyWindowStart', () => {
  describe('Standard use cases', () => {
    it('should truncate to the minute, hour and day (UTC)', () => {
      expect(getApiKeyWindowStart('minute', NOW)).toBe(1790709720);
      expect(getApiKeyWindowStart('hour', NOW)).toBe(1790708400);
      expect(getApiKeyWindowStart('day', NOW)).toBe(1790640000);
    });

    it('should start weeks on Monday 00:00 UTC', () => {
      // Monday 2026-09-28
      expect(getApiKeyWindowStart('week', NOW)).toBe(1790553600);
    });

    it('should start months on the 1st 00:00 UTC', () => {
      expect(getApiKeyWindowStart('month', NOW)).toBe(1788220800);
    });
  });

  describe('Edge cases', () => {
    it('should keep a window start as its own start', () => {
      expect(getApiKeyWindowStart('week', 1790553600)).toBe(1790553600);
      expect(getApiKeyWindowStart('day', 1790640000)).toBe(1790640000);
      expect(getApiKeyWindowStart('month', 1788220800)).toBe(1788220800);
    });

    it('should put the last second of a Sunday in the week before', () => {
      expect(getApiKeyWindowStart('week', 1790553599)).toBe(
        1790553600 - 7 * 86400,
      );
    });

    it('should handle ISO weeks crossing a year boundary', () => {
      // Friday 2027-01-01 belongs to the week starting Monday 2026-12-28
      expect(getApiKeyWindowStart('week', 1798761600)).toBe(1798416000);
      // Sunday 2021-01-03 belongs to the week starting Monday 2020-12-28
      expect(getApiKeyWindowStart('week', 1609632000)).toBe(
        1609718400 - 7 * 86400,
      );
    });

    it('should handle a leap day', () => {
      expect(getApiKeyWindowStart('month', 1709164800 + 3600)).toBe(
        Date.UTC(2024, 1, 1) / 1000,
      );
    });

    it('should ignore fractions of a second', () => {
      expect(getApiKeyWindowStart('minute', NOW + 0.999)).toBe(1790709720);
    });

    it('should handle the epoch (a Thursday)', () => {
      expect(getApiKeyWindowStart('week', 0)).toBe(-3 * 86400);
    });
  });
});
