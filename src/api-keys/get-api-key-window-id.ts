import type { ApiKeyWindow } from './api-key-record.interface';
import { getApiKeyWindowStart } from './get-api-key-window-start';

/**
 * Window part of a counter key name: the window start in epoch seconds for
 * `minute`, `hour`, `day` and `week` (for example `1790709720`), and
 * `YYYY-MM` for `month` (for example `2026-09`). UTC.
 *
 * @param window - Limit window
 * @param nowSeconds - Any time inside the window (epoch seconds)
 */
export function getApiKeyWindowId(
  window: ApiKeyWindow,
  nowSeconds: number,
): string {
  const start = getApiKeyWindowStart(window, nowSeconds);

  if (window === 'month') {
    const date = new Date(start * 1000);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${date.getUTCFullYear()}-${month}`;
  }

  return String(start);
}
