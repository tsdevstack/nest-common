import type { API_KEY_STATUSES, API_KEY_WINDOWS } from './api-keys.constants';

/** A limit window: `minute`, `hour`, `day`, `week` or `month` (UTC) */
export type ApiKeyWindow = (typeof API_KEY_WINDOWS)[number];

/** Record `status`: `active` or `revoked` */
export type ApiKeyRecordStatus =
  (typeof API_KEY_STATUSES)[keyof typeof API_KEY_STATUSES];

/**
 * Per-window request limits of a key. A window that is absent is not limited
 * by the key; Kong falls back to its `default_limits` for it.
 */
export type ApiKeyRecordLimits = Partial<Record<ApiKeyWindow, number>>;

/**
 * API key record, version 1, stored as JSON at `apikey:{<h>}:rec`.
 *
 * - Absent optional fields are omitted, never `null`.
 * - Times are integer epoch seconds (UTC).
 * - `limits` is always present (possibly `{}`); limit values are integers
 *   from 1 to 2^31 - 1 (`API_KEY_RECORD_LIMIT_MAX`).
 * - A key is expired from the second `expiresAt` on (`now >= expiresAt`).
 *
 * TTL of the Redis entry: none for an active key without expiry; one day
 * after `expiresAt` for an expiring key; one day after the revocation for a
 * revoked key.
 *
 * @example
 * ```json
 * {"v":1,"id":"6f1c...","consumer":"acme-corp","status":"active","limits":{"minute":60,"month":100000},"expiresAt":1793491200}
 * ```
 */
export interface ApiKeyRecord {
  /** Record format version */
  v: 1;

  /** Key identifier, forwarded to backends as `X-Api-Key-Id` */
  id: string;

  /** Who the key was issued to, forwarded as `X-Api-Key-Consumer` */
  consumer: string;

  /** `revoked` keys get 401 `api_key_revoked` */
  status: ApiKeyRecordStatus;

  /** The key's own limits per window */
  limits: ApiKeyRecordLimits;

  /** Expiry (epoch seconds); from this second on the key gets 401 `api_key_expired` */
  expiresAt?: number;
}

/** Result of {@link validateApiKeyRecord} */
export type ApiKeyRecordValidation =
  { valid: true; record: ApiKeyRecord } | { valid: false; errors: string[] };
