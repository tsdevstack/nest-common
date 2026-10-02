import { describe, it, expect } from '@rstest/core';
import { getApiKeyWindowId } from './get-api-key-window-id';

const NOW = 1790709764; // 2026-09-29T19:22:44Z

describe('getApiKeyWindowId', () => {
  it('should use the window start in epoch seconds for minute to week', () => {
    expect(getApiKeyWindowId('minute', NOW)).toBe('1790709720');
    expect(getApiKeyWindowId('hour', NOW)).toBe('1790708400');
    expect(getApiKeyWindowId('day', NOW)).toBe('1790640000');
    expect(getApiKeyWindowId('week', NOW)).toBe('1790553600');
  });

  it('should use YYYY-MM for months', () => {
    expect(getApiKeyWindowId('month', NOW)).toBe('2026-09');
    expect(getApiKeyWindowId('month', Date.UTC(2027, 0, 1) / 1000)).toBe(
      '2027-01',
    );
  });

  it('should use UTC, not local time, at a month boundary', () => {
    // 2026-09-30T23:59:59Z is still September in UTC
    expect(getApiKeyWindowId('month', 1790812799)).toBe('2026-09');
    expect(getApiKeyWindowId('month', 1790812800)).toBe('2026-10');
  });
});
