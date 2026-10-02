import { API_KEY_REDIS_PREFIX } from './api-keys.constants';
import { assertApiKeyHash } from './assert-api-key-hash';

/**
 * Redis key of a key's record: `apikey:{<h>}:rec`.
 *
 * The hash in braces is a Redis Cluster hash tag: every entry of one key
 * (record, counters, last-used) lands in the same slot, so one script call
 * may touch all of them.
 *
 * @param keyHash - sha256 hex of the raw key ({@link hashApiKey})
 */
export function buildApiKeyRecordKey(keyHash: string): string {
  assertApiKeyHash(keyHash);
  return `${API_KEY_REDIS_PREFIX}:{${keyHash}}:rec`;
}
