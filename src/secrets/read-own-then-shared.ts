import { SHARED_SECRETS_SCOPE } from './secrets.constants';

/**
 * The lookup rule for every provider: a key in the service's own scope wins
 * over the same key in the shared scope.
 *
 * Both scopes are read at once, so a lookup waits for one round-trip. A
 * failed read of the service's own scope fails the lookup even when shared
 * has the key: a value there would have won, so the shared one may be wrong.
 *
 * @param read - Reads one scope; null when the scope has no such key
 * @param serviceName - The service's own scope
 * @returns The value, or null when neither scope has the key
 */
export async function readOwnThenShared(
  read: (scope: string) => Promise<string | null>,
  serviceName: string,
): Promise<string | null> {
  const [own, shared] = await Promise.allSettled([
    read(serviceName),
    read(SHARED_SECRETS_SCOPE),
  ]);

  if (own.status === 'rejected') {
    throw own.reason;
  }
  if (own.value !== null) {
    return own.value;
  }
  if (shared.status === 'rejected') {
    throw shared.reason;
  }
  return shared.value;
}
