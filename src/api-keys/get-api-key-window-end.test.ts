import { describe, it, expect } from '@rstest/core';
import { getApiKeyWindowEnd } from './get-api-key-window-end';

const NOW = 1790709764; // 2026-09-29T19:22:44Z

describe('getApiKeyWindowEnd', () => {
  it('should return the start of the next window', () => {
    expect(getApiKeyWindowEnd('minute', NOW)).toBe(1790709780);
    expect(getApiKeyWindowEnd('hour', NOW)).toBe(1790712000);
    expect(getApiKeyWindowEnd('day', NOW)).toBe(1790726400);
    expect(getApiKeyWindowEnd('week', NOW)).toBe(1790553600 + 7 * 86400);
    expect(getApiKeyWindowEnd('month', NOW)).toBe(1790812800); // 2026-10-01
  });

  it('should roll months over the year end', () => {
    expect(getApiKeyWindowEnd('month', Date.UTC(2026, 11, 31) / 1000)).toBe(
      Date.UTC(2027, 0, 1) / 1000,
    );
  });

  it('should treat the end as exclusive', () => {
    expect(getApiKeyWindowEnd('minute', 1790709780)).toBe(1790709840);
  });
});
