/**
 * Hash Email For Key
 *
 * Turns an email address into a stable, opaque Redis key fragment.
 *
 * Rate limiting only needs equality — the same address must map to the same
 * counter — so the plaintext is never required. Keeping it out of the
 * keyspace matters because key names leak through SCAN, MONITOR, RDB/AOF
 * files on disk and any Redis browser UI, none of which are places user
 * email addresses belong.
 *
 * Truncated to 32 hex chars (128 bits): collision risk is negligible and the
 * key stays short.
 */

import { createHash } from 'node:crypto';

export function hashEmailForKey(email: string): string {
  return createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex')
    .slice(0, 32);
}
