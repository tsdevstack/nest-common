/** Injection token for MessagingModuleOptions */
export const MESSAGING_OPTIONS_TOKEN = 'MESSAGING_OPTIONS';

/** Injection token for the dedicated consumer Redis connection */
export const MESSAGING_CONSUMER_REDIS_TOKEN = 'MESSAGING_CONSUMER_REDIS';

/** Metadata key for @OnMessage decorator */
export const ON_MESSAGE_METADATA = 'messaging:on_message_topic';

/** Default MAXLEN for stream trimming */
export const DEFAULT_MAX_LEN = 10_000;

/** Default XREADGROUP block time in milliseconds */
export const DEFAULT_BLOCK_TIME_MS = 5_000;

/** Default idle threshold before reclaiming stuck messages (ms) */
export const DEFAULT_CLAIM_MIN_IDLE_MS = 60_000;

/** Default max retries before sending to DLQ */
export const DEFAULT_MAX_RETRIES = 3;

/** Default XREADGROUP COUNT per read */
export const DEFAULT_READ_COUNT = 10;

/** Interval between XPENDING + XCLAIM checks (ms) */
export const DEFAULT_CLAIM_CHECK_INTERVAL_MS = 30_000;

/** Graceful shutdown timeout for in-flight handlers (ms) */
export const SHUTDOWN_TIMEOUT_MS = 5_000;
