/**
 * Claim Stuck Messages
 *
 * Checks for and reclaims stuck messages via XPENDING + XCLAIM.
 * Messages exceeding maxRetries are moved to the DLQ stream.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { IncomingMessage } from './messaging.interface';
import { DEFAULT_READ_COUNT, DEFAULT_MAX_LEN } from './messaging.constants';
import { parseStreamEntry } from './parse-stream-entry';

export async function claimStuckMessages(
  redis: Redis,
  streamKey: string,
  groupName: string,
  consumerName: string,
  topic: string,
  dlqStreamKey: string,
  handler: (message: IncomingMessage) => Promise<void>,
  logger: Logger,
  claimMinIdleMs: number,
  maxRetries: number,
  dlqMaxLen: number = DEFAULT_MAX_LEN,
): Promise<void> {
  try {
    // Get pending messages for this group
    const pending = (await redis.xpending(
      streamKey,
      groupName,
      '-',
      '+',
      DEFAULT_READ_COUNT,
    )) as Array<[string, string, number, number]>;

    if (!pending || pending.length === 0) return;

    for (const [entryId, , idleMs, deliveryCount] of pending) {
      if (idleMs < claimMinIdleMs) continue;

      if (deliveryCount >= maxRetries) {
        // Move to DLQ
        try {
          // Read the original message before acking
          const rangeResult = await redis.xrange(streamKey, entryId, entryId);
          if (rangeResult.length > 0) {
            const [, fields] = rangeResult[0];
            // Find the 'data' field value
            let dataStr = '{}';
            for (let i = 0; i < fields.length; i += 2) {
              if (fields[i] === 'data') {
                dataStr = fields[i + 1];
                break;
              }
            }
            // MAXLEN ~ matches the publish path — an uncapped DLQ grows
            // forever, and Redis runs noeviction, so it would eventually
            // OOM the shared instance (BullMQ + rate limiting + messaging).
            await redis.xadd(
              dlqStreamKey,
              'MAXLEN',
              '~',
              String(dlqMaxLen),
              '*',
              'data',
              dataStr,
              'originalId',
              entryId,
              'deliveryCount',
              String(deliveryCount),
              'topic',
              topic,
            );
          }
          await redis.xack(streamKey, groupName, entryId);
          logger.warn(
            `Message ${entryId} on topic "${topic}" moved to DLQ after ${deliveryCount} deliveries`,
          );
        } catch (dlqError) {
          logger.error(
            `Failed to move message ${entryId} to DLQ: ${
              dlqError instanceof Error ? dlqError.message : 'Unknown error'
            }`,
          );
        }
      } else {
        // Reclaim and redeliver
        try {
          const claimed = await redis.xclaim(
            streamKey,
            groupName,
            consumerName,
            claimMinIdleMs,
            entryId,
          );

          if (claimed.length > 0) {
            const [claimedId, fields] = claimed[0] as [string, string[]];
            try {
              const message = parseStreamEntry(
                claimedId,
                fields,
                topic,
                deliveryCount,
              );
              await handler(message);
              await redis.xack(streamKey, groupName, claimedId);
            } catch {
              // Still failing — leave pending for next claim cycle
              logger.warn(
                `Retry ${deliveryCount} failed for message ${claimedId} on topic "${topic}"`,
              );
            }
          }
        } catch (claimError) {
          logger.error(
            `Failed to claim message ${entryId}: ${
              claimError instanceof Error ? claimError.message : 'Unknown error'
            }`,
          );
        }
      }
    }
  } catch (error) {
    logger.error(
      `Failed to check pending messages on topic "${topic}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}
