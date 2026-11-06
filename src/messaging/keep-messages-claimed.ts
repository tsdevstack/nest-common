/**
 * Keep Messages Claimed
 *
 * Tells Redis "still working on these" for the messages a consumer holds:
 * the one whose handler runs and the rest of its batch. XCLAIM with JUSTID
 * resets a message's idle time without counting a delivery, so another
 * instance's stuck-message check (which takes messages idle for
 * claimMinIdleMs) never takes a message that is still being handled.
 *
 * Only messages this consumer still owns are touched. One that another
 * instance already took over (this process was paused for longer than
 * claimMinIdleMs) stays with that instance.
 */

import type Redis from 'ioredis';

export async function keepMessagesClaimed(
  redis: Redis,
  streamKey: string,
  groupName: string,
  consumerName: string,
  entryIds: string[],
): Promise<void> {
  if (entryIds.length === 0) return;

  const pipeline = redis.pipeline();
  for (const entryId of entryIds) {
    pipeline.xpending(streamKey, groupName, entryId, entryId, 1, consumerName);
  }
  const results = (await pipeline.exec()) ?? [];

  const owned = entryIds.filter((_, index) => {
    const [error, rows] = results[index] ?? [];
    return !error && Array.isArray(rows) && rows.length > 0;
  });
  if (owned.length === 0) return;

  await redis.xclaim(streamKey, groupName, consumerName, 0, ...owned, 'JUSTID');
}
