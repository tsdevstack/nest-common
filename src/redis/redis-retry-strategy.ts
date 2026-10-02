import {
  REDIS_RECONNECT_BASE_DELAY_MS,
  REDIS_RECONNECT_MAX_DELAY_MS,
} from './redis.constants';

/**
 * ioredis `retryStrategy`: exponential backoff capped at 5 seconds, never
 * giving up.
 *
 * ioredis stops reconnecting for good when this returns a non-number, so it
 * always returns a delay: a Redis restart, failover or maintenance window of
 * any length is survived without restarting the service. ioredis resets the
 * attempt counter once the connection is ready again.
 *
 * @param times - Reconnect attempt number, starting at 1
 * @returns Delay before the next attempt, in milliseconds
 */
export function redisRetryStrategy(times: number): number {
  const exponent = Math.max(0, times - 1);
  return Math.min(
    REDIS_RECONNECT_BASE_DELAY_MS * 2 ** exponent,
    REDIS_RECONNECT_MAX_DELAY_MS,
  );
}
