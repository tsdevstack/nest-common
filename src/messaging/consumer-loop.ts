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
  DEFAULT_READ_COUNT,
  DEFAULT_CLAIM_CHECK_INTERVAL_MS,
} from './messaging.constants';
import { parseStreamEntry } from './parse-stream-entry';
import { claimStuckMessages } from './claim-stuck-messages';

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
  } = options;

  let running = true;
  let resolveStop: (() => void) | null = null;
  let lastClaimCheck = Date.now();

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
            for (const [entryId, fields] of entries) {
              try {
                const message = parseStreamEntry(entryId, fields, topic, 0);
                await handler(message);
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
              }
            }
          }
        } else {
          // No messages — yield to event loop to prevent tight spinning
          // (In production, XREADGROUP BLOCK handles this; mocks resolve instantly)
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // Step 2: Periodically check for stuck messages
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
          );
        }
      } catch (loopError) {
        if (!running) break;
        // Transient Redis error — log and retry after a brief pause
        logger.error(
          `Consumer loop error on topic "${topic}": ${
            loopError instanceof Error ? loopError.message : 'Unknown error'
          }`,
        );
        // Brief backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

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
