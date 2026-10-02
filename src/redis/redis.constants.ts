/** First reconnect delay after a lost Redis connection (ms) */
export const REDIS_RECONNECT_BASE_DELAY_MS = 100;

/** Upper bound of the reconnect backoff (ms); the client never stops retrying */
export const REDIS_RECONNECT_MAX_DELAY_MS = 5000;

/** How long the health indicator waits for PING before reporting down (ms) */
export const REDIS_HEALTH_PING_TIMEOUT_MS = 2000;
