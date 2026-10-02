/**
 * Hash API Key For Key
 *
 * Turns a raw API key into an opaque Redis key fragment. Key names leak
 * through SCAN, MONITOR, RDB/AOF files and Redis browser UIs, so a raw key
 * must never appear in one. Rate limiting only needs equality, which the
 * sha256 hex digest keeps.
 */

import { createHash } from 'node:crypto';

export function hashApiKeyForKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}
