import { Request } from 'express';

/**
 * User object extracted from Kong headers.
 *
 * Kong forwards JWT claims as `X-JWT-Claim-*` headers, which are
 * dynamically extracted into this object. The `id` field is always
 * present (from `X-Consumer-ID`), but all other fields are dynamic
 * based on JWT claims.
 *
 * @example
 * ```typescript
 * // Kong headers:
 * // X-Consumer-ID: user-123
 * // X-JWT-Claim-Email: user@example.com
 * // X-JWT-Claim-Roles: USER,ADMIN
 * // X-JWT-Claim-TenantId: tenant-456
 *
 * // Resulting KongUser:
 * {
 *   id: "user-123",
 *   email: "user@example.com",
 *   roles: ["USER", "ADMIN"],
 *   tenantId: "tenant-456"
 * }
 * ```
 */
export interface KongUser {
  /** User ID from X-Consumer-ID (JWT sub claim) */
  id: string;

  /** Dynamic claims extracted from X-JWT-Claim-* headers */
  [key: string]: string | string[] | number | boolean | undefined;
}

/**
 * Express Request with Kong authentication populated.
 *
 * After KongAuthGuard processes the request, either `user` (JWT auth)
 * or `service` (API key auth) will be populated.
 */
export interface AuthenticatedRequest extends Request {
  /** User object (JWT authentication) */
  user?: KongUser;

  /** Service name (API key authentication) */
  service?: string;
}

/**
 * Kong header names for type safety.
 *
 * These are the standard headers that Kong sets after validating
 * JWT tokens or API keys.
 */
export enum KongHeaders {
  /** Consumer ID (JWT sub claim) */
  CONSUMER_ID = 'x-consumer-id',

  /** Consumer username (API key service name) */
  CONSUMER_USERNAME = 'x-consumer-username',

  /** Credential identifier (JWT sub claim from kong-oidc-v3) */
  CREDENTIAL_IDENTIFIER = 'x-credential-identifier',

  /** JWT claims as JSON (kong-oidc-v3 plugin) */
  USERINFO = 'x-userinfo',

  /** Prefix for JWT claim headers (legacy) */
  JWT_CLAIM_PREFIX = 'x-jwt-claim-',
}