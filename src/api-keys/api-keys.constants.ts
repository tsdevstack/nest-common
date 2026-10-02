/**
 * Redis contract of the API key index, shared by the Kong plugin
 * `tsdevstack-api-key` (reader) and whatever writes the records (the auth
 * service template, or a project's own tooling).
 *
 * This is a public, versioned contract: key names, record fields and TTL
 * rules must not change without a new record version `v`. Kong plugin
 * versions keep reading every earlier version.
 */

/** Prefix of every Redis key of the API key index */
export const API_KEY_REDIS_PREFIX = 'apikey';

/**
 * Index marker. Written last by every rebuild; its absence means Redis lost
 * the index (a record miss then gives 503 `index_unavailable` instead of 401).
 * Only ever used with single-key commands: it lives in another hash slot than
 * the per-key entries.
 */
export const API_KEY_INDEX_MARKER_KEY = 'apikey:meta';

/**
 * Rebuild lock, so only one writer instance rebuilds the index at a time.
 * Single-key commands only.
 */
export const API_KEY_REBUILD_LOCK_KEY = 'apikey:rebuild-lock';

/** Record format version written by this package */
export const API_KEY_RECORD_VERSION = 1;

/** Every record format version this package can read */
export const API_KEY_RECORD_VERSIONS: readonly number[] = [1];

/** Limit windows, in the order they are checked. All in UTC. */
export const API_KEY_WINDOWS = [
  'minute',
  'hour',
  'day',
  'week',
  'month',
] as const;

/**
 * Key name segment of each window's counter
 * (`apikey:{<h>}:<segment>:<start>`).
 */
export const API_KEY_WINDOW_KEY_SEGMENTS = {
  minute: 'min',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
} as const;

/** Record `status` values */
export const API_KEY_STATUSES = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const;

/**
 * How long a record stays in Redis after the key stops working: one day
 * after `expiresAt` for expiring keys, one day after the revocation for
 * revoked keys. Redis removes it on its own through the TTL.
 */
export const API_KEY_RECORD_RETENTION_SECONDS = 86_400;

/**
 * Extra lifetime of week and month counters after their window ends, so the
 * usage sync can still copy the final total of a finished period. Minute,
 * hour and day counters expire at the end of their window.
 */
export const API_KEY_QUOTA_COUNTER_RETENTION_SECONDS = 86_400;

/** The last-used time (`apikey:{<h>}:lu`) is written at most this often */
export const API_KEY_LAST_USED_WRITE_INTERVAL_SECONDS = 60;

/** TTL of the last-used entry, refreshed on every write */
export const API_KEY_LAST_USED_TTL_SECONDS = 30 * 86_400;

/** ISO week length in seconds */
export const API_KEY_WEEK_SECONDS = 7 * 86_400;

/**
 * Allowed `id` and `consumer` values in a record: 1 to 128 characters of
 * letters, digits, `.`, `_` and `-` (both are forwarded as header values).
 */
export const API_KEY_RECORD_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Highest limit a record may carry per window (2^31 - 1, the largest value
 * a Postgres INTEGER limit column holds). Limits are positive integers up to
 * this value.
 */
export const API_KEY_RECORD_LIMIT_MAX = 2_147_483_647;
