import { KongHeaders } from '../auth-user.interface';
import type { AuthenticatedApiKey, KongUser } from '../auth-user.interface';
import { parseUserinfoHeader } from './parse-userinfo-header';
import { readHeader } from './read-header';

/**
 * Identity vouched for by a Kong plugin, or `conflict` when the request
 * carries both a user and an API key identity (no Kong route sets both, so
 * one of them is forged).
 */
export type GatewayIdentity =
  | { authType: 'user'; user: KongUser }
  | { authType: 'apiKey'; apiKey: AuthenticatedApiKey }
  | { authType: 'conflict' };

/** Headers that identify an API key (tsdevstack-api-key plugin) */
const KEY_IDENTITY_HEADERS: readonly string[] = [
  KongHeaders.API_KEY_ID,
  KongHeaders.API_KEY_CONSUMER,
];

/**
 * Classifies a request by the Kong plugin that vouched for it.
 *
 * - `X-Userinfo` together with any API key identity header
 *   (`X-Api-Key-Id`, `X-Api-Key-Consumer`) is a conflict: treated as forged.
 * - `X-Userinfo` (OIDC plugin) gives a user. When it is present but cannot be
 *   parsed, the request has no gateway identity; it never falls through to
 *   another classification.
 * - `X-Api-Key-Id` and `X-Api-Key-Consumer` (key plugin) give a partner key.
 * - Nothing else produces an identity: the consumer headers of Kong's
 *   bundled auth plugins (`X-Consumer-*`, `X-Credential-Identifier`) are
 *   ignored; they never mean a user or a partner key.
 *
 * Only call this after the Kong trust token was verified; without it the
 * headers may be forged.
 *
 * @param headers - Request headers
 * @returns The identity, `conflict`, or null
 */
export function classifyGatewayIdentity(
  headers: Record<string, string | string[] | undefined>,
): GatewayIdentity | null {
  const userinfo = readHeader(headers, KongHeaders.USERINFO);
  if (userinfo !== undefined) {
    const hasKeyIdentity = KEY_IDENTITY_HEADERS.some(
      (name) => readHeader(headers, name) !== undefined,
    );
    if (hasKeyIdentity) {
      return { authType: 'conflict' };
    }

    const user = parseUserinfoHeader(userinfo);
    return user ? { authType: 'user', user } : null;
  }

  const keyId = readHeader(headers, KongHeaders.API_KEY_ID);
  const consumer = readHeader(headers, KongHeaders.API_KEY_CONSUMER);
  if (keyId && consumer) {
    return { authType: 'apiKey', apiKey: { id: keyId, consumer } };
  }

  return null;
}
