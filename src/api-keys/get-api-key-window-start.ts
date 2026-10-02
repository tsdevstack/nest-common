import type { ApiKeyWindow } from './api-key-record.interface';

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

/**
 * Start of the window that contains `nowSeconds`, in epoch seconds (UTC).
 *
 * - `minute`, `hour`, `day`: truncated to the unit.
 * - `week`: Monday 00:00 UTC (ISO week).
 * - `month`: the 1st, 00:00 UTC.
 *
 * @param window - Limit window
 * @param nowSeconds - Epoch seconds (fractions are truncated)
 */
export function getApiKeyWindowStart(
  window: ApiKeyWindow,
  nowSeconds: number,
): number {
  const now = Math.floor(nowSeconds);

  switch (window) {
    case 'minute':
      return now - (now % MINUTE);
    case 'hour':
      return now - (now % HOUR);
    case 'day':
      return now - (now % DAY);
    case 'week': {
      const day = Math.floor(now / DAY);
      // Day 0 (1970-01-01) was a Thursday; Monday-based weekday index
      const weekday = (((day + 3) % 7) + 7) % 7;
      return (day - weekday) * DAY;
    }
    case 'month': {
      const date = new Date(now * 1000);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
    }
  }
}
