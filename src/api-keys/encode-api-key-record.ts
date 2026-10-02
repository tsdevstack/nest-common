import type { ApiKeyRecord } from './api-key-record.interface';
import { API_KEY_WINDOWS } from './api-keys.constants';
import { validateApiKeyRecord } from './validate-api-key-record';

/**
 * Serializes a record to the JSON stored at `apikey:{<h>}:rec`.
 *
 * The output is deterministic: fields in the order `v`, `id`, `consumer`,
 * `status`, `limits` (windows in the order minute, hour, day, week, month),
 * `expiresAt`; absent fields omitted.
 *
 * @param record - Record to encode
 * @returns Compact JSON
 * @throws Error when the record breaks the contract
 */
export function encodeApiKeyRecord(record: ApiKeyRecord): string {
  const validation = validateApiKeyRecord(record);
  if (!validation.valid) {
    throw new Error(`Invalid API key record: ${validation.errors.join('; ')}`);
  }

  const { record: valid } = validation;
  const limits: Record<string, number> = {};
  for (const window of API_KEY_WINDOWS) {
    const limit = valid.limits[window];
    if (limit !== undefined) {
      limits[window] = limit;
    }
  }

  return JSON.stringify({
    v: valid.v,
    id: valid.id,
    consumer: valid.consumer,
    status: valid.status,
    limits,
    ...(valid.expiresAt !== undefined && { expiresAt: valid.expiresAt }),
  });
}
