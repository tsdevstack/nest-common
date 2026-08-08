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

/** Interval between idle-consumer reap sweeps (ms) */
export const DEFAULT_REAP_INTERVAL_MS = 300_000;

/**
 * Idle time after which a consumer with no pending entries is removed (ms).
 * A live consumer blocks for DEFAULT_BLOCK_TIME_MS at a time, so its idle
 * time stays orders of magnitude below this.
 */
export const DEFAULT_REAP_IDLE_MS = 600_000;

/**
 * Max serialized payload size per published message (bytes).
 * MAXLEN caps entry count, not bytes — without this, maxLen * payload size
 * is the real memory ceiling.
 */
export const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

/** Graceful shutdown timeout for in-flight handlers (ms) */
export const SHUTDOWN_TIMEOUT_MS = 5_000;
