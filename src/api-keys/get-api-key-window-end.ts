import type { ApiKeyWindow } from './api-key-record.interface';
import { API_KEY_WEEK_SECONDS } from './api-keys.constants';
import { getApiKeyWindowStart } from './get-api-key-window-start';

const WINDOW_SECONDS = {
  minute: 60,
  hour: 3_600,
  day: 86_400,
  week: API_KEY_WEEK_SECONDS,
} as const;

/**
 * End of the window that contains `nowSeconds` (exclusive), in epoch
 * seconds: the start of the next window. Used for counter TTLs and
 * `Retry-After`.
 *
 * @param window - Limit window
 * @param nowSeconds - Epoch seconds
 */
export function getApiKeyWindowEnd(
  window: ApiKeyWindow,
  nowSeconds: number,
): number {
  const start = getApiKeyWindowStart(window, nowSeconds);

  if (window === 'month') {
    const date = new Date(start * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  }

  return start + WINDOW_SECONDS[window];
}
