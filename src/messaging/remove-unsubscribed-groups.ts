/**
 * Remove Unsubscribed Groups
 *
 * Deletes a service's consumer groups on topics it no longer subscribes to.
 *
 * Every subscriber group holds back the deleting of read messages
 * (trimReadMessages keeps what the group furthest behind still needs). A
 * group left behind by a removed subscription never reads again, so its
 * topic's stream would grow until Redis is full, and Redis runs noeviction:
 * then every write fails.
 *
 * A group is deleted only once none of its consumers has read for
 * idleThresholdMs. Right after a deploy, the previous version of the service
 * can still be reading it; a group deleted under it would be recreated from
 * the start (NOGROUP recovery in the consumer loop) and its messages handled
 * again.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

/** Idle time of one consumer from the flat array XINFO CONSUMERS returns */
function idleOf(entry: unknown): number {
  if (!Array.isArray(entry)) return 0;
  for (let i = 0; i < entry.length - 1; i += 2) {
    if (entry[i] === 'idle') return Number(entry[i + 1]);
  }
  // Unknown: treat the consumer as active, so the group stays
  return 0;
}

export async function removeUnsubscribedGroups(
  redis: Redis,
  prefix: string,
  consumerGroup: string,
  topics: string[],
  logger: Logger,
  idleThresholdMs: number,
): Promise<void> {
  const base = `${prefix}:messaging:`;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${base}*`,
        'COUNT',
        100,
        'TYPE',
        'stream',
      );
      cursor = next;

      for (const streamKey of keys) {
        const topic = streamKey.slice(base.length);
        if (topic.endsWith(':dlq') || topics.includes(topic)) continue;

        const groupName = `${streamKey}:${consumerGroup}`;
        let consumers: unknown[];
        try {
          consumers = (await redis.xinfo(
            'CONSUMERS',
            streamKey,
            groupName,
          )) as unknown[];
        } catch (error: unknown) {
          // This service never subscribed to the topic
          if (error instanceof Error && error.message.includes('NOGROUP')) {
            continue;
          }
          throw error;
        }

        if (consumers.some((entry) => idleOf(entry) < idleThresholdMs)) {
          continue;
        }

        await redis.xgroup('DESTROY', streamKey, groupName);
        logger.log(
          `Removed consumer group "${groupName}": this service no longer subscribes to topic "${topic}"`,
        );
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.error(
      `Failed to remove consumer groups of unsubscribed topics: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}
