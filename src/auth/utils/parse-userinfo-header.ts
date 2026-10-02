import type { KongUser } from '../auth-user.interface';
import { UNSAFE_CLAIM_KEYS } from '../auth.constants';

/**
 * Builds the user from the `X-Userinfo` header set by Kong's OIDC plugin.
 *
 * kong-oidc-v3 forwards every JWT claim as base64-encoded JSON. The `sub`
 * claim becomes `id`; every other claim is copied with its JSON type, except
 * `__proto__`, `constructor` and `prototype` (prototype pollution).
 *
 * @param value - Raw `X-Userinfo` header value
 * @returns The user, or null when the header is not base64 JSON with a string `sub`
 */
export function parseUserinfoHeader(value: string): KongUser | null {
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));
  } catch {
    return null;
  }

  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    return null;
  }

  const record = claims as Record<string, KongUser[string]>;
  const sub = record.sub;
  if (typeof sub !== 'string' || sub === '') {
    return null;
  }

  const user: KongUser = { id: sub };
  for (const [key, claim] of Object.entries(record)) {
    if (key !== 'sub' && !UNSAFE_CLAIM_KEYS.has(key)) {
      user[key] = claim;
    }
  }
  return user;
}
