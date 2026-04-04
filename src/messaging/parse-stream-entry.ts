/**
 * Parse Stream Entry
 *
 * Converts a raw Redis stream entry into an IncomingMessage.
 */

import type { IncomingMessage } from './messaging.interface';

export function parseStreamEntry(
  entryId: string,
  fields: string[],
  topic: string,
  retryCount: number,
): IncomingMessage {
  // Fields come as [key1, val1, key2, val2, ...]
  let dataStr = '{}';
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === 'data') {
      dataStr = fields[i + 1];
      break;
    }
  }

  // Extract timestamp from stream ID (format: timestamp-sequence)
  const timestamp = parseInt(entryId.split('-')[0], 10);

  return {
    id: entryId,
    topic,
    data: JSON.parse(dataStr) as Record<string, unknown>,
    publishedAt: new Date(timestamp),
    retryCount,
  };
}
