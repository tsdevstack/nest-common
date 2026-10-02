import { API_KEY_REDIS_PREFIX } from './api-keys.constants';
import { assertApiKeyHash } from './assert-api-key-hash';

/**
 * Redis key of a key's last-used time: `apikey:{<h>}:lu`.
 *
 * Value: integer epoch seconds, written by Kong at most once a minute
 * (`API_KEY_LAST_USED_WRITE_INTERVAL_SECONDS`) with a TTL of
 * `API_KEY_LAST_USED_TTL_SECONDS`; the usage sync copies it to the database.
 *
 * @param keyHash - sha256 hex of the raw key ({@link hashApiKey})
 */
export function buildApiKeyLastUsedKey(keyHash: string): string {
  assertApiKeyHash(keyHash);
  return `${API_KEY_REDIS_PREFIX}:{${keyHash}}:lu`;
}
