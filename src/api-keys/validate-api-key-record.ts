import type {
  ApiKeyRecord,
  ApiKeyRecordLimits,
  ApiKeyRecordStatus,
  ApiKeyRecordValidation,
} from './api-key-record.interface';
import {
  API_KEY_RECORD_IDENTIFIER_PATTERN,
  API_KEY_RECORD_LIMIT_MAX,
  API_KEY_RECORD_VERSIONS,
  API_KEY_STATUSES,
  API_KEY_WINDOWS,
} from './api-keys.constants';
import { isPlainObject } from './is-plain-object';
import { isPositiveSafeInteger } from './is-positive-safe-integer';

const STATUSES: readonly string[] = Object.values(API_KEY_STATUSES);
const WINDOWS: readonly string[] = API_KEY_WINDOWS;

/**
 * Runtime check of a decoded record against the contract (version 1).
 *
 * Rules: `v` is a known version; `id` and `consumer` match
 * `API_KEY_RECORD_IDENTIFIER_PATTERN`; `status` is `active` or `revoked`;
 * `limits` is an object whose keys are windows and whose values are
 * integers from 1 to `API_KEY_RECORD_LIMIT_MAX` (2^31 - 1); `expiresAt`,
 * when present, is a positive integer (epoch seconds). Absent fields must be
 * omitted: `null` is invalid. Unknown extra fields are ignored and not copied
 * into the result.
 *
 * @param value - Parsed JSON
 * @returns The normalized record, or every rule it breaks
 */
export function validateApiKeyRecord(value: unknown): ApiKeyRecordValidation {
  if (!isPlainObject(value)) {
    return { valid: false, errors: ['record must be a JSON object'] };
  }

  const errors: string[] = [];

  if (!API_KEY_RECORD_VERSIONS.includes(value.v as number)) {
    errors.push(
      `v must be one of ${API_KEY_RECORD_VERSIONS.join(', ')} (got ${JSON.stringify(value.v)})`,
    );
  }

  for (const field of ['id', 'consumer'] as const) {
    const fieldValue = value[field];
    if (
      typeof fieldValue !== 'string' ||
      !API_KEY_RECORD_IDENTIFIER_PATTERN.test(fieldValue)
    ) {
      errors.push(
        `${field} must be 1 to 128 characters of letters, digits, ".", "_" or "-"`,
      );
    }
  }

  if (typeof value.status !== 'string' || !STATUSES.includes(value.status)) {
    errors.push(`status must be one of ${STATUSES.join(', ')}`);
  }

  const limits: ApiKeyRecordLimits = {};
  if (!isPlainObject(value.limits)) {
    errors.push('limits must be an object (use {} for no limits)');
  } else {
    for (const [window, limit] of Object.entries(value.limits)) {
      if (!WINDOWS.includes(window)) {
        errors.push(`limits.${window} is not a window (${WINDOWS.join(', ')})`);
      } else if (
        !isPositiveSafeInteger(limit) ||
        limit > API_KEY_RECORD_LIMIT_MAX
      ) {
        errors.push(
          `limits.${window} must be an integer from 1 to ${API_KEY_RECORD_LIMIT_MAX}`,
        );
      } else {
        limits[window as keyof ApiKeyRecordLimits] = limit;
      }
    }
  }

  if ('expiresAt' in value && !isPositiveSafeInteger(value.expiresAt)) {
    errors.push(
      'expiresAt must be a positive integer (epoch seconds) or omitted',
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const record: ApiKeyRecord = {
    v: 1,
    id: value.id as string,
    consumer: value.consumer as string,
    status: value.status as ApiKeyRecordStatus,
    limits,
  };
  if (value.expiresAt !== undefined) {
    record.expiresAt = value.expiresAt as number;
  }

  return { valid: true, record };
}
