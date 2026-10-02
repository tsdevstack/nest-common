const API_KEY_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Guards key-name builders against building names from anything but a
 * sha256 hex digest (a raw key or an uppercase digest would silently point
 * at a different entry than Kong reads).
 *
 * @param keyHash - Value to check
 * @throws Error when it is not 64 lowercase hex characters
 */
export function assertApiKeyHash(keyHash: string): void {
  if (!API_KEY_HASH_PATTERN.test(keyHash)) {
    throw new Error(
      'API key hash must be a sha256 hex digest (64 lowercase hex characters); hash the raw key with hashApiKey()',
    );
  }
}
