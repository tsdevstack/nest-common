/**
 * Has Consumer Groups
 *
 * Whether a stream has at least one subscriber group. A stream that doesn't
 * exist yet has none.
 */

import type Redis from 'ioredis';

export async function hasConsumerGroups(
  redis: Redis,
  streamKey: string,
): Promise<boolean> {
  try {
    const groups = (await redis.xinfo('GROUPS', streamKey)) as unknown[];
    return groups.length > 0;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('no such key')) {
      return false;
    }
    throw error;
  }
}
