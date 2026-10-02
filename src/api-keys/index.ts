// API key index: the Redis contract read by Kong's tsdevstack-api-key plugin
export {
  API_KEY_REDIS_PREFIX,
  API_KEY_INDEX_MARKER_KEY,
  API_KEY_REBUILD_LOCK_KEY,
  API_KEY_RECORD_VERSION,
  API_KEY_RECORD_VERSIONS,
  API_KEY_WINDOWS,
  API_KEY_WINDOW_KEY_SEGMENTS,
  API_KEY_STATUSES,
  API_KEY_RECORD_RETENTION_SECONDS,
  API_KEY_QUOTA_COUNTER_RETENTION_SECONDS,
  API_KEY_LAST_USED_WRITE_INTERVAL_SECONDS,
  API_KEY_LAST_USED_TTL_SECONDS,
  API_KEY_WEEK_SECONDS,
  API_KEY_RECORD_IDENTIFIER_PATTERN,
  API_KEY_RECORD_LIMIT_MAX,
} from './api-keys.constants';
export type {
  ApiKeyRecord,
  ApiKeyRecordLimits,
  ApiKeyRecordStatus,
  ApiKeyRecordValidation,
  ApiKeyWindow,
} from './api-key-record.interface';
export { hashApiKey } from './hash-api-key';
export { buildApiKeyRecordKey } from './build-api-key-record-key';
export { buildApiKeyCounterKey } from './build-api-key-counter-key';
export { buildApiKeyLastUsedKey } from './build-api-key-last-used-key';
export { getApiKeyWindowStart } from './get-api-key-window-start';
export { getApiKeyWindowEnd } from './get-api-key-window-end';
export { getApiKeyWindowId } from './get-api-key-window-id';
export { getApiKeyCounterExpireAt } from './get-api-key-counter-expire-at';
export { getApiKeyRecordExpireAt } from './get-api-key-record-expire-at';
export { validateApiKeyRecord } from './validate-api-key-record';
export { encodeApiKeyRecord } from './encode-api-key-record';
export { decodeApiKeyRecord } from './decode-api-key-record';
