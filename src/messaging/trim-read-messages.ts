/**
 * Trim Read Messages
 *
 * Deletes the stream entries every subscriber group has finished, and only
 * those.
 *
 * Redis keeps stream entries until something deletes them: XACK only marks
 * an entry done for one group. Publishing doesn't trim a stream once it has
 * a subscriber (a length cap deletes the oldest entries whether read or not),
 * so the subscribers trim it here.
 *
 * Per group, the oldest entry it still needs is its oldest pending entry
 * (delivered, not confirmed) or, with nothing pending, its last delivered
 * entry (everything before it is confirmed). XTRIM MINID deletes everything
 * older than the oldest of those over all groups. Redis 6.2 or later.
 *
 * A group that never reads again (a subscriber that sleeps or was removed)
 * keeps everything after its position, so the stream grows.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

interface GroupInfo {
  name: string;
  pending: number;
  lastDeliveredId: string;
}

/** Parse the flat field array XINFO GROUPS returns for each group */
function parseGroupInfo(entry: unknown): GroupInfo | null {
  if (!Array.isArray(entry)) return null;

  let name = '';
  let pending = -1;
  let lastDeliveredId = '';

  for (let i = 0; i < entry.length - 1; i += 2) {
    const field = entry[i];
    const value = entry[i + 1];

    if (field === 'name' && typeof value === 'string') name = value;
    if (field === 'pending') pending = Number(value);
    if (field === 'last-delivered-id' && typeof value === 'string') {
      lastDeliveredId = value;
    }
  }

  if (!name || pending < 0 || !lastDeliveredId) return null;
  return { name, pending, lastDeliveredId };
}

/** Stream entry ID ("<ms>-<seq>") as a sortable number */
function toSortable(entryId: string): bigint {
  const [ms, seq = '0'] = entryId.split('-');
  return (BigInt(ms) << 64n) + BigInt(seq);
}

export async function trimReadMessages(
  redis: Redis,
  streamKey: string,
  logger: Logger,
): Promise<void> {
  try {
    const groups = ((await redis.xinfo('GROUPS', streamKey)) as unknown[])
      .map(parseGroupInfo)
      .filter((group): group is GroupInfo => group !== null);

    if (groups.length === 0) return;

    let oldestNeeded: string | null = null;
    for (const group of groups) {
      let needed = group.lastDeliveredId;
      if (group.pending > 0) {
        const [, oldestPending] = (await redis.xpending(
          streamKey,
          group.name,
        )) as [number, string | null, string | null, unknown];
        if (oldestPending) needed = oldestPending;
      }
      if (
        oldestNeeded === null ||
        toSortable(needed) < toSortable(oldestNeeded)
      ) {
        oldestNeeded = needed;
      }
    }

    // A group that hasn't read anything yet needs the whole stream
    if (oldestNeeded === null || toSortable(oldestNeeded) === 0n) return;

    await redis.xtrim(streamKey, 'MINID', '~', oldestNeeded);
  } catch (error) {
    logger.error(
      `Failed to trim read messages on "${streamKey}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}
