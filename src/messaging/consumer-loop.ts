/**
 * Start Consumer Loop
 *
 * Runs the XREADGROUP polling loop for a single topic.
 * Returns a stop function for graceful shutdown.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { IncomingMessage } from './messaging.interface';
import {
  DEFAULT_BLOCK_TIME_MS,
  DEFAULT_CLAIM_MIN_IDLE_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_LEN,
  DEFAULT_READ_COUNT,
  DEFAULT_CLAIM_CHECK_INTERVAL_MS,
  DEFAULT_REAP_INTERVAL_MS,
  DEFAULT_REAP_IDLE_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from './messaging.constants';
import { parseStreamEntry } from './parse-stream-entry';
import { runMessageHandler } from './run-message-handler';
import { claimStuckMessages } from './claim-stuck-messages';
import { reapIdleConsumers } from './reap-idle-consumers';
import { ensureConsumerGroup } from './ensure-consumer-group';
import { keepMessagesClaimed } from './keep-messages-claimed';
import { trimReadMessages } from './trim-read-messages';

export interface ConsumerLoopOptions {
  /** The ioredis client (dedicated connection with maxRetriesPerRequest: null) */
  redis: Redis;
  /** Full stream key (e.g., 'tsdevstack:messaging:user-created') */
  streamKey: string;
  /** Full consumer group name (e.g., 'tsdevstack:messaging:user-created:offers-service') */
  groupName: string;
  /** Unique consumer name within the group (e.g., 'offers-service:hostname:pid') */
  consumerName: string;
  /** Topic name (without prefix, for IncomingMessage) */
  topic: string;
  /** Full DLQ stream key */
  dlqStreamKey: string;
  /** Handler function to call for each message */
  handler: (message: IncomingMessage) => Promise<void>;
  /** NestJS logger instance */
  logger: Logger;
  /** XREADGROUP BLOCK time in ms */
  blockTimeMs?: number;
  /** Idle threshold before reclaiming via XCLAIM (ms) */
  claimMinIdleMs?: number;
  /** Max delivery attempts before DLQ */
  maxRetries?: number;
  /** Approximate MAXLEN trim applied to the DLQ stream */
  maxLen?: number;
}

export function startConsumerLoop(options: ConsumerLoopOptions): {
  stop: () => Promise<void>;
} {
  const {
    redis,
    streamKey,
    groupName,
    consumerName,
    topic,
    dlqStreamKey,
    handler,
    logger,
    blockTimeMs = DEFAULT_BLOCK_TIME_MS,
    claimMinIdleMs = DEFAULT_CLAIM_MIN_IDLE_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxLen = DEFAULT_MAX_LEN,
  } = options;

  let running = true;
  let resolveStop: (() => void) | null = null;
  let lastClaimCheck = Date.now();
  let lastReapCheck = Date.now();

  // Messages this consumer holds: read or claimed, handler not finished.
  // While it holds any, it tells Redis "still working on them" so another
  // instance doesn't take them over and run them a second time.
  const held = new Set<string>();
  let heartbeatRunning = false;
  const heartbeat = setInterval(
    () => {
      if (held.size === 0 || heartbeatRunning) return;
      heartbeatRunning = true;
      keepMessagesClaimed(redis, streamKey, groupName, consumerName, [...held])
        .catch((error: unknown) => {
          logger.warn(
            `Failed to keep messages claimed on topic "${topic}": ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    },
    // A third of the idle threshold at most, so two signals can be late
    Math.max(
      1_000,
      Math.min(DEFAULT_HEARTBEAT_INTERVAL_MS, Math.floor(claimMinIdleMs / 3)),
    ),
  );
  heartbeat.unref();

  const loop = async (): Promise<void> => {
    while (running) {
      try {
        // Step 1: Read new messages
        const results = await redis.xreadgroup(
          'GROUP',
          groupName,
          consumerName,
          'COUNT',
          DEFAULT_READ_COUNT,
          'BLOCK',
          blockTimeMs,
          'STREAMS',
          streamKey,
          '>',
        );

        if (results) {
          const typedResults = results as Array<
            [string, Array<[string, string[]]>]
          >;
          for (const [, entries] of typedResults) {
            for (const [entryId] of entries) held.add(entryId);
            for (const [entryId, fields] of entries) {
              try {
                const message = parseStreamEntry(entryId, fields, topic, 0);
                await runMessageHandler(handler, message, fields);
                // Success → XACK
                await redis.xack(streamKey, groupName, entryId);
              } catch (handlerError) {
                // Handler failed — leave pending (no XACK)
                logger.warn(
                  `Handler failed for message ${entryId} on topic "${topic}": ${
                    handlerError instanceof Error
                      ? handlerError.message
                      : 'Unknown error'
                  }`,
                );
              } finally {
                held.delete(entryId);
              }
            }
          }
        } else {
          // No messages — yield to event loop to prevent tight spinning
          // (In production, XREADGROUP BLOCK handles this; mocks resolve instantly)
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // Step 2: Periodically check for stuck messages and delete read ones
        if (Date.now() - lastClaimCheck >= DEFAULT_CLAIM_CHECK_INTERVAL_MS) {
          lastClaimCheck = Date.now();
          await claimStuckMessages(
            redis,
            streamKey,
            groupName,
            consumerName,
            topic,
            dlqStreamKey,
            handler,
            logger,
            claimMinIdleMs,
            maxRetries,
            maxLen,
            held,
          );
          // Delete what every subscriber group finished
          await trimReadMessages(redis, streamKey, logger);
        }

        // Step 3: Periodically remove consumers left behind by dead replicas
        if (Date.now() - lastReapCheck >= DEFAULT_REAP_INTERVAL_MS) {
          lastReapCheck = Date.now();
          await reapIdleConsumers(
            redis,
            streamKey,
            groupName,
            consumerName,
            logger,
            DEFAULT_REAP_IDLE_MS,
          );
        }
      } catch (loopError) {
        if (!running) break;
        const message =
          loopError instanceof Error ? loopError.message : 'Unknown error';
        // The stream or group is gone (Redis flushed, restarted empty, or
        // failed over): recreate the group instead of failing forever
        if (message.includes('NOGROUP')) {
          logger.warn(
            `Consumer group missing on topic "${topic}", recreating it`,
          );
          try {
            await ensureConsumerGroup(redis, streamKey, groupName, logger);
            continue;
          } catch (recreateError) {
            logger.error(
              `Failed to recreate consumer group on topic "${topic}": ${
                recreateError instanceof Error
                  ? recreateError.message
                  : 'Unknown error'
              }`,
            );
          }
        } else {
          // Transient Redis error — log and retry after a brief pause
          logger.error(`Consumer loop error on topic "${topic}": ${message}`);
        }
        // Brief backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    clearInterval(heartbeat);

    // Signal that loop has stopped
    if (resolveStop) resolveStop();
  };

  // Start the loop (fire and forget — runs until stopped)
  loop().catch((error) => {
    logger.error(
      `Consumer loop crashed for topic "${topic}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  });

  return {
    stop: (): Promise<void> => {
      running = false;

      // Wait for loop to exit
      return new Promise((resolve) => {
        resolveStop = resolve;
      });
    },
  };
}
