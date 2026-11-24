/** First reconnect delay after a lost Redis connection (ms) */
export const REDIS_RECONNECT_BASE_DELAY_MS = 100;

/** Upper bound of the reconnect backoff (ms); the client never stops retrying */
export const REDIS_RECONNECT_MAX_DELAY_MS = 5000;

/** How long the health indicator waits for PING before reporting down (ms) */
export const REDIS_HEALTH_PING_TIMEOUT_MS = 2000;

/**
 * Wire protocol for every connection the framework opens. ioredis 6 defaults
 * to RESP3 (HELLO 3); RESP2 is the protocol verified against Memorystore,
 * ElastiCache and Azure Managed Redis in the phase 48 live rounds. Switching
 * to RESP3 is a deliberate change for a later live round.
 */
export const REDIS_PROTOCOL = 2;

/** Lua for deleteIfEquals: DEL only while the key holds the given value */
export const REDIS_DELETE_IF_EQUALS_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';
