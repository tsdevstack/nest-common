export interface MessagingModuleOptions {
  /** This service's name, used as consumer group prefix (e.g., 'offers-service') */
  consumerGroup: string;
  /** Topics to subscribe to. Omit or pass empty for publish-only services. */
  topics?: string[];
  /** Max delivery attempts before sending to DLQ (default: 3) */
  maxRetries?: number;
  /** XREADGROUP block time in milliseconds (default: 5000) */
  blockTimeMs?: number;
  /** Stream MAXLEN approximate trim on publish (default: 10000) */
  maxLen?: number;
  /** Reclaim stuck messages after this idle time in ms (default: 60000) */
  claimMinIdleMs?: number;
}

export interface IncomingMessage {
  /** Redis stream entry ID (e.g., '1709312000000-0') */
  id: string;
  /** Topic name (without project prefix) */
  topic: string;
  /** Parsed message payload */
  data: Record<string, unknown>;
  /** Extracted from stream ID timestamp */
  publishedAt: Date;
  /** Number of times this message has been delivered */
  retryCount: number;
}

export interface MessageHandler {
  /** The topic this handler listens to */
  topic: string;
  /** The handler function to call */
  handler: (message: IncomingMessage) => Promise<void>;
}
