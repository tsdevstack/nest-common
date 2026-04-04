import { Injectable, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import {
  MESSAGING_OPTIONS_TOKEN,
  MESSAGING_CONSUMER_REDIS_TOKEN,
  DEFAULT_MAX_LEN,
  SHUTDOWN_TIMEOUT_MS,
} from './messaging.constants';
import type {
  MessagingModuleOptions,
  IncomingMessage,
  MessageHandler,
} from './messaging.interface';
import { MessagingError, MessagingErrorCode } from './messaging.error';
import { ensureConsumerGroup } from './ensure-consumer-group';
import { startConsumerLoop } from './consumer-loop';

@Injectable()
export class MessagingService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly handlers: MessageHandler[] = [];
  private readonly stopFns: Array<() => Promise<void>> = [];
  private readonly prefix: string;
  private started = false;

  constructor(
    private readonly redisService: RedisService,
    @Inject(MESSAGING_OPTIONS_TOKEN)
    private readonly options: MessagingModuleOptions,
    @Inject(MESSAGING_CONSUMER_REDIS_TOKEN)
    private readonly consumerRedis: Redis,
  ) {
    // Derive prefix from env or fall back to 'app'
    this.prefix = process.env.PROJECT_NAME || 'app';
  }

  /**
   * Register a handler for a topic. Called by MessagingModule during init.
   */
  registerHandler(
    topic: string,
    handler: (message: IncomingMessage) => Promise<void>,
  ): void {
    this.handlers.push({ topic, handler });
  }

  /**
   * Start all consumer loops. Called by MessagingModule after handler discovery.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const topics = this.options.topics ?? [];
    if (topics.length === 0) {
      this.logger.log('No topics to subscribe to — publish-only mode');
      return;
    }

    const consumerName = `${this.options.consumerGroup}:${process.pid}`;

    for (const topic of topics) {
      const streamKey = `${this.prefix}:messaging:${topic}`;
      const groupName = `${this.prefix}:messaging:${topic}:${this.options.consumerGroup}`;
      const dlqStreamKey = `${this.prefix}:messaging:${topic}:dlq`;

      // Find handler for this topic
      const handlerEntry = this.handlers.find((h) => h.topic === topic);
      if (!handlerEntry) {
        this.logger.warn(
          `No @OnMessage handler found for topic "${topic}" — messages will not be consumed`,
        );
        continue;
      }

      // Create consumer group (idempotent)
      await ensureConsumerGroup(
        this.consumerRedis,
        streamKey,
        groupName,
        this.logger,
      );

      // Start consumer loop
      const { stop } = startConsumerLoop({
        redis: this.consumerRedis,
        streamKey,
        groupName,
        consumerName,
        topic,
        dlqStreamKey,
        handler: handlerEntry.handler,
        logger: this.logger,
        blockTimeMs: this.options.blockTimeMs,
        claimMinIdleMs: this.options.claimMinIdleMs,
        maxRetries: this.options.maxRetries,
      });

      this.stopFns.push(stop);
      this.logger.log(`Consuming topic "${topic}" as group "${groupName}"`);
    }
  }

  /**
   * Publish a message to a topic.
   * Uses the shared RedisService connection (non-blocking XADD).
   */
  async publish(topic: string, data: Record<string, unknown>): Promise<string> {
    const streamKey = `${this.prefix}:messaging:${topic}`;
    const maxLen = this.options.maxLen ?? DEFAULT_MAX_LEN;

    try {
      const entryId = await this.redisService
        .getClient()
        .xadd(
          streamKey,
          'MAXLEN',
          '~',
          String(maxLen),
          '*',
          'data',
          JSON.stringify(data),
        );

      if (!entryId) {
        throw new Error('XADD returned null');
      }

      return entryId;
    } catch (error) {
      throw new MessagingError(
        MessagingErrorCode.PUBLISH_FAILED,
        topic,
        error,
        `Failed to publish to topic "${topic}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Graceful shutdown — stop consumer loops and wait for in-flight handlers.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down messaging consumers...');

    // Stop all consumer loops
    const stopPromises = this.stopFns.map((stop) => stop());

    // Wait with timeout
    await Promise.race([
      Promise.all(stopPromises),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          this.logger.warn(
            `Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) — some handlers may not have completed`,
          );
          resolve();
        }, SHUTDOWN_TIMEOUT_MS),
      ),
    ]);

    // Disconnect the dedicated consumer connection
    this.consumerRedis.disconnect();
    this.logger.log('Messaging consumers shut down');
  }
}
