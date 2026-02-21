import { KongUser, KongHeaders } from '../auth-user.interface';
import { toCamelCase } from './to-camel-case';
import { parseHeaderValue } from './parse-header-value';

/**
 * Extracts user object from Kong headers.
 *
 * Dynamically extracts ALL JWT claims from headers that start with
 * `X-JWT-Claim-*`. This makes the authentication future-proof - any
 * new claims added to the JWT will automatically flow through without
 * code changes.
 *
 * @param headers - HTTP headers from the request
 * @returns User object with id and all dynamic claims
 *
 * @example Basic extraction
 * ```typescript
 * const headers = {
 *   'x-consumer-id': 'user-123',
 *   'x-jwt-claim-email': 'user@example.com',
 *   'x-jwt-claim-roles': 'USER,ADMIN',
 * };
 *
 * extractUserFromHeaders(headers);
 * // {
 * //   id: 'user-123',
 * //   email: 'user@example.com',
 * //   roles: ['USER', 'ADMIN']
 * // }
 * ```
 *
 * @example With camelCase conversion
 * ```typescript
 * const headers = {
 *   'x-consumer-id': 'user-123',
 *   'x-jwt-claim-tenant-id': 'tenant-456',
 *   'x-jwt-claim-is-verified': 'true',
 * };
 *
 * extractUserFromHeaders(headers);
 * // {
 * //   id: 'user-123',
 * //   tenantId: 'tenant-456',
 * //   isVerified: true
 * // }
 * ```
 */
export function extractUserFromHeaders(
  headers: Record<string, string>,
): KongUser {
  const user: KongUser = { id: headers[KongHeaders.CONSUMER_ID] };

  // Dynamically extract ALL JWT claims
  Object.keys(headers).forEach((key) => {
    if (key.startsWith(KongHeaders.JWT_CLAIM_PREFIX)) {
      // Extract claim name (remove prefix)
      const claimName = key.replace(KongHeaders.JWT_CLAIM_PREFIX, '');

      // Convert to camelCase (tenant-id → tenantId)
      const camelCase = toCamelCase(claimName);

      // Parse value intelligently
      user[camelCase] = parseHeaderValue(headers[key]);
    }
  });

  return user;
}