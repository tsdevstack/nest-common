import { describe, it, expect } from '@rstest/core';
import { getApiKeyCounterExpireAt } from './get-api-key-counter-expire-at';

const NOW = 1790709764; // 2026-09-29T19:22:44Z

describe('getApiKeyCounterExpireAt', () => {
  it('should expire minute, hour and day counters at the window end', () => {
    expect(getApiKeyCounterExpireAt('minute', NOW)).toBe(1790709780);
    expect(getApiKeyCounterExpireAt('hour', NOW)).toBe(1790712000);
    expect(getApiKeyCounterExpireAt('day', NOW)).toBe(1790726400);
  });

  it('should keep week and month counters one day past the window end', () => {
    expect(getApiKeyCounterExpireAt('week', NOW)).toBe(
      1790553600 + 7 * 86400 + 86400,
    );
    expect(getApiKeyCounterExpireAt('month', NOW)).toBe(1790812800 + 86400);
  });
});
