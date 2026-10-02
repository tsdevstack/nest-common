import {
  API_KEY_REDIS_PREFIX,
  API_KEY_WINDOW_KEY_SEGMENTS,
} from './api-keys.constants';
import type { ApiKeyWindow } from './api-key-record.interface';
import { assertApiKeyHash } from './assert-api-key-hash';
import { getApiKeyWindowId } from './get-api-key-window-id';

/**
 * Redis key of the counter of the window that contains `nowSeconds`:
 * `apikey:{<h>}:min:<start>`, `:hour:<start>`, `:day:<start>`,
 * `:week:<start>` (window start in epoch seconds, UTC; weeks start on
 * Monday) or `:month:<YYYY-MM>`.
 *
 * Value: integer count of admitted requests in that window.
 *
 * @param keyHash - sha256 hex of the raw key ({@link hashApiKey})
 * @param window - Limit window
 * @param nowSeconds - Any time inside the window (epoch seconds)
 */
export function buildApiKeyCounterKey(
  keyHash: string,
  window: ApiKeyWindow,
  nowSeconds: number,
): string {
  assertApiKeyHash(keyHash);
  const segment = API_KEY_WINDOW_KEY_SEGMENTS[window];
  return `${API_KEY_REDIS_PREFIX}:{${keyHash}}:${segment}:${getApiKeyWindowId(window, nowSeconds)}`;
}
