import type { ApiKeyWindow } from './api-key-record.interface';
import { API_KEY_QUOTA_COUNTER_RETENTION_SECONDS } from './api-keys.constants';
import { getApiKeyWindowEnd } from './get-api-key-window-end';

/**
 * When a window counter expires (absolute epoch seconds, for `EXPIREAT`),
 * set when the counter is created.
 *
 * Minute, hour and day counters expire at the end of their window. Week and
 * month counters live `API_KEY_QUOTA_COUNTER_RETENTION_SECONDS` longer, so the
 * usage sync can still copy the final total of the finished period.
 *
 * @param window - Limit window
 * @param nowSeconds - Any time inside the window (epoch seconds)
 */
export function getApiKeyCounterExpireAt(
  window: ApiKeyWindow,
  nowSeconds: number,
): number {
  const end = getApiKeyWindowEnd(window, nowSeconds);
  return window === 'week' || window === 'month'
    ? end + API_KEY_QUOTA_COUNTER_RETENTION_SECONDS
    : end;
}
