import type { ApiKeyRecord } from './api-key-record.interface';
import {
  API_KEY_RECORD_RETENTION_SECONDS,
  API_KEY_STATUSES,
} from './api-keys.constants';

/**
 * When a record's Redis entry expires (absolute epoch seconds, for
 * `EXAT`), or `null` for no TTL.
 *
 * - Revoked: one day after the revocation (`nowSeconds`, the time the
 *   revoked record is written).
 * - Active with `expiresAt`: one day after `expiresAt`.
 * - Active without expiry: no TTL.
 *
 * A result at or before `nowSeconds` means the record should not exist.
 *
 * @param record - Record about to be written
 * @param nowSeconds - Current time (epoch seconds)
 */
export function getApiKeyRecordExpireAt(
  record: ApiKeyRecord,
  nowSeconds: number,
): number | null {
  if (record.status === API_KEY_STATUSES.REVOKED) {
    return Math.floor(nowSeconds) + API_KEY_RECORD_RETENTION_SECONDS;
  }

  if (record.expiresAt !== undefined) {
    return record.expiresAt + API_KEY_RECORD_RETENTION_SECONDS;
  }

  return null;
}
