/**
 * Reap Idle Consumers
 *
 * Removes long-idle consumers with an empty pending list from a group.
 *
 * Consumer registrations are implicit (XREADGROUP creates them) but never
 * implicit-ly removed — they outlive the process. Graceful shutdown handles
 * the clean case; this covers crashes, OOM kills and scale-to-zero, where no
 * shutdown hook ever runs. Without it, every container replacement leaves a
 * permanent entry in the group.
 *
 * Only consumers with zero pending entries are removed, so this can never
 * drop an unacked message. A live-but-idle consumer is re-registered
 * automatically on its next read.
 */

import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

interface ConsumerInfo {
  name: string;
  pending: number;
  idleMs: number;
}

/** Parse the flat field array XINFO CONSUMERS returns for each consumer */
function parseConsumerInfo(entry: unknown): ConsumerInfo | null {
  if (!Array.isArray(entry)) return null;

  let name = '';
  let pending = -1;
  let idleMs = -1;

  for (let i = 0; i < entry.length - 1; i += 2) {
    const field = entry[i];
    const value = entry[i + 1];

    if (field === 'name' && typeof value === 'string') name = value;
    if (field === 'pending') pending = Number(value);
    if (field === 'idle') idleMs = Number(value);
  }

  if (!name || pending < 0 || idleMs < 0) return null;
  return { name, pending, idleMs };
}

export async function reapIdleConsumers(
  redis: Redis,
  streamKey: string,
  groupName: string,
  selfConsumerName: string,
  logger: Logger,
  idleThresholdMs: number,
): Promise<void> {
  try {
    const consumers = (await redis.xinfo(
      'CONSUMERS',
      streamKey,
      groupName,
    )) as unknown[];

    if (!Array.isArray(consumers)) return;

    for (const entry of consumers) {
      const info = parseConsumerInfo(entry);
      if (!info) continue;

      // Never reap ourselves, anything holding unacked messages, or anything
      // that has been seen recently enough to plausibly still be alive.
      if (info.name === selfConsumerName) continue;
      if (info.pending > 0) continue;
      if (info.idleMs < idleThresholdMs) continue;

      await redis.xgroup('DELCONSUMER', streamKey, groupName, info.name);
      logger.log(
        `Reaped idle consumer "${info.name}" from group "${groupName}" (idle ${info.idleMs}ms, no pending)`,
      );
    }
  } catch (error) {
    // Best-effort housekeeping — never disrupt the consumer loop
    logger.warn(
      `Failed to reap idle consumers on "${streamKey}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}
