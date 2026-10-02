import type { ApiKeyRecord } from './api-key-record.interface';
import { validateApiKeyRecord } from './validate-api-key-record';

/**
 * Parses and validates the JSON stored at `apikey:{<h>}:rec`.
 *
 * @param json - Stored value
 * @returns The record (unknown extra fields dropped)
 * @throws Error when the value is not JSON or breaks the contract (including
 *   an unknown `v`)
 */
export function decodeApiKeyRecord(json: string): ApiKeyRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid API key record: not valid JSON');
  }

  const validation = validateApiKeyRecord(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid API key record: ${validation.errors.join('; ')}`);
  }

  return validation.record;
}
