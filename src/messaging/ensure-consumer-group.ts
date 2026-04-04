/**
 * Ensure Consumer Group
 *
 * Creates a Redis consumer group for a stream, idempotently.
 * Catches BUSYGROUP error if the group already exists.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

export async function ensureConsumerGroup(
  redis: Redis,
  streamKey: string,
  groupName: string,
  logger: Logger,
): Promise<void> {
  try {
    // MKSTREAM creates the stream if it doesn't exist
    await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
    logger.log(`Created consumer group "${groupName}" on "${streamKey}"`);
  } catch (error: unknown) {
    // BUSYGROUP = group already exists — this is expected and fine
    if (error instanceof Error && error.message.includes('BUSYGROUP')) {
      return;
    }
    throw error;
  }
}
