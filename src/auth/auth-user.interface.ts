import { Request } from 'express';

/**
 * User object built from the gateway's `X-Userinfo` header.
 *
 * Kong's OIDC plugin validates the JWT and forwards all of its claims as
 * base64-encoded JSON in `X-Userinfo`. `AuthGuard` decodes it: the `sub`
 * claim becomes `id`, every other claim is copied as is.
 *
 * @example
 * ```typescript
 * // X-Userinfo (decoded):
 * // { "sub": "user-123", "email": "user@example.com", "systemRole": "ADMIN", "roles": ["EDITOR"] }
 *
 * // Resulting KongUser:
 * {
 *   id: "user-123",
 *   email: "user@example.com",
 *   systemRole: "ADMIN",
 *   roles: ["EDITOR"]
 * }
 * ```
 */
export interface KongUser {
  /** User ID (JWT `sub` claim) */
  id: string;

  /** Every other JWT claim, with its original JSON type */
  [key: string]: string | string[] | number | boolean | undefined;
}

/**
 * How the caller of a request was authenticated.
 *
 * - `user`: a logged-in user; Kong's OIDC plugin validated the JWT (`req.user`)
 * - `apiKey`: a partner API key validated by Kong (`req.apiKey`, `req.service === 'partner'`)
 * - `service`: an internal service call with this service's `API_KEY` (`req.service`)
 */
export type AuthType = 'user' | 'apiKey' | 'service';

/**
 * The partner API key that authenticated a request, as reported by Kong.
 * Never contains the raw key.
 */
export interface AuthenticatedApiKey {
  /** Key identifier (`X-Api-Key-Id`) */
  id: string;

  /** Who the key was issued to, for example `acme-corp` (`X-Api-Key-Consumer`) */
  consumer: string;
}

/**
 * Express Request with authentication populated by `AuthGuard`.
 *
 * `authType` says which of `user`, `apiKey` or `service` is set. On a
 * `@Public()` route without credentials, none of them is set.
 */
export interface AuthenticatedRequest extends Request {
  /** How the caller was authenticated; undefined for anonymous public requests */
  authType?: AuthType;

  /** Logged-in user (`authType === 'user'`) */
  user?: KongUser;

  /** Partner API key (`authType === 'apiKey'`) */
  apiKey?: AuthenticatedApiKey;

  /**
   * Calling service: the `X-Service-Name` of an internal caller (or
   * `'internal'`) when `authType === 'service'`, `'partner'` when
   * `authType === 'apiKey'`.
   */
  service?: string;

  /**
   * True when the request came through Kong: AuthGuard verified the
   * `X-Kong-Trust` token. Gateway-set headers such as `X-Real-IP` are
   * trustworthy only then.
   */
  viaGateway?: boolean;
}

/**
 * Header names read by `AuthGuard` (lowercase, as Node exposes them).
 */
export enum KongHeaders {
  /** Proof that the request came through Kong (set by the gateway's request-transformer) */
  KONG_TRUST = 'x-kong-trust',

  /** JWT claims as base64 JSON (kong-oidc-v3 plugin) */
  USERINFO = 'x-userinfo',

  /** Partner API key identifier (tsdevstack-api-key plugin) */
  API_KEY_ID = 'x-api-key-id',

  /** Partner API key consumer name (tsdevstack-api-key plugin) */
  API_KEY_CONSUMER = 'x-api-key-consumer',

  /** Service API key for internal service-to-service calls */
  API_KEY = 'x-api-key',

  /** Name of the calling service on internal calls */
  SERVICE_NAME = 'x-service-name',
}
