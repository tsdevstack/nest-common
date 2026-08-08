/**
 * Delete Consumer If Empty
 *
 * Removes a consumer from a group, but only when it has no pending entries.
 *
 * XGROUP DELCONSUMER drops the consumer's entire pending list — any message
 * still held there would never be redelivered or acked. Gating on an empty
 * PEL makes the delete lossless: if the consumer is still alive, its next
 * XREADGROUP simply re-registers it.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

export async function deleteConsumerIfEmpty(
  redis: Redis,
  streamKey: string,
  groupName: string,
  consumerName: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const pending = (await redis.xpending(
      streamKey,
      groupName,
      '-',
      '+',
      1,
      consumerName,
    )) as unknown[];

    if (pending && pending.length > 0) {
      logger.log(
        `Consumer "${consumerName}" still has pending messages — leaving it for reclaim`,
      );
      return false;
    }

    await redis.xgroup('DELCONSUMER', streamKey, groupName, consumerName);
    return true;
  } catch (error) {
    // Cleanup is best-effort — never block shutdown on it
    logger.warn(
      `Failed to remove consumer "${consumerName}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
    return false;
  }
}
