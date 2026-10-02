import { createHash } from 'node:crypto';

/**
 * Hashes a raw API key the way Kong's key plugin does: sha256 over the exact
 * header value (UTF-8), as 64 lowercase hex characters. The hash is the
 * `<h>` in every Redis key name of the index and the only form a key is
 * stored in.
 *
 * @param rawKey - The key as the client sends it in `x-api-key`
 * @returns sha256 hex digest
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}
