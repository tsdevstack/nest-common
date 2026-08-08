import { Injectable, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import {
  MESSAGING_OPTIONS_TOKEN,
  MESSAGING_CONSUMER_REDIS_TOKEN,
  DEFAULT_MAX_LEN,
  DEFAULT_MAX_PAYLOAD_BYTES,
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
import { deleteConsumerIfEmpty } from './delete-consumer-if-empty';

@Injectable()
export class MessagingService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly handlers: MessageHandler[] = [];
  private readonly stopFns: Array<() => Promise<void>> = [];
  private readonly prefix: string;
  private started = false;

  /** Consumer registrations to clean up on shutdown */
  private readonly registrations: Array<{
    streamKey: string;
    groupName: string;
    consumerName: string;
  }> = [];

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

    // Consumer names must be unique per running instance. Two instances
    // sharing a name share a pending list, which lets one reclaim a message
    // another is still working on.
    //
    // PID alone is not unique: the image runs `dumb-init node`, so every
    // container reports the same low PID. hostname() is unique under Docker,
    // but whether every managed runtime sets a distinct one is not something
    // this code should assume, so a per-process random id is what actually
    // guarantees uniqueness. hostname and PID stay in the name because they
    // make a consumer traceable back to a container when debugging.
    //
    // Stale names are cleaned up automatically (see reapIdleConsumers), so a
    // fresh id per start does not accumulate.
    const instanceId = randomBytes(4).toString('hex');
    const consumerName = `${this.options.consumerGroup}:${hostname()}:${process.pid}:${instanceId}`;

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
        maxLen: this.options.maxLen,
      });

      this.stopFns.push(stop);
      this.registrations.push({ streamKey, groupName, consumerName });
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
    const maxPayloadBytes =
      this.options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;

    const serialized = JSON.stringify(data);
    const payloadBytes = Buffer.byteLength(serialized, 'utf8');

    // MAXLEN bounds entry count, not bytes — the stream's real memory ceiling
    // is maxLen * payload size, so an oversized payload multiplies into an OOM
    // on a noeviction instance.
    //
    // Warn rather than throw: publishing a large payload works today, and
    // turning that into a runtime failure on a patch upgrade would break
    // running services with no warning. This gives operators a signal in
    // their logs first; a future release turns it into an error.
    if (payloadBytes > maxPayloadBytes) {
      this.logger.warn(
        `Message payload for topic "${topic}" is ${payloadBytes} bytes, ` +
          `over the ${maxPayloadBytes} byte limit. A future release will ` +
          `reject this. Publish a reference (for example an object storage ` +
          `key) instead of the payload itself, or raise maxPayloadBytes if ` +
          `this size is expected.`,
      );
    }

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
          serialized,
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

    // Deregister this instance's consumers so they don't accumulate in the
    // group. Runs after the loops have stopped, and skips any consumer still
    // holding pending messages so nothing is dropped.
    for (const { streamKey, groupName, consumerName } of this.registrations) {
      await deleteConsumerIfEmpty(
        this.consumerRedis,
        streamKey,
        groupName,
        consumerName,
        this.logger,
      );
    }

    // Disconnect the dedicated consumer connection
    this.consumerRedis.disconnect();
    this.logger.log('Messaging consumers shut down');
  }
}
