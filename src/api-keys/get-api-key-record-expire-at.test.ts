import { describe, it, expect } from '@rstest/core';
import { getApiKeyRecordExpireAt } from './get-api-key-record-expire-at';
import type { ApiKeyRecord } from './api-key-record.interface';

const NOW = 1790709764;
const base: ApiKeyRecord = {
  v: 1,
  id: 'key-1',
  consumer: 'acme-corp',
  status: 'active',
  limits: {},
};

describe('getApiKeyRecordExpireAt', () => {
  it('should return null for an active key without expiry', () => {
    expect(getApiKeyRecordExpireAt(base, NOW)).toBeNull();
  });

  it('should keep an expiring key one day past its expiry', () => {
    expect(
      getApiKeyRecordExpireAt({ ...base, expiresAt: NOW + 3600 }, NOW),
    ).toBe(NOW + 3600 + 86400);
  });

  it('should return a past time for a key that expired more than a day ago', () => {
    const expireAt = getApiKeyRecordExpireAt(
      { ...base, expiresAt: NOW - 2 * 86400 },
      NOW,
    );
    expect(expireAt).not.toBeNull();
    expect(expireAt as number).toBeLessThanOrEqual(NOW);
  });

  it('should keep a revoked record one day from now, whatever its expiry', () => {
    expect(getApiKeyRecordExpireAt({ ...base, status: 'revoked' }, NOW)).toBe(
      NOW + 86400,
    );
    expect(
      getApiKeyRecordExpireAt(
        { ...base, status: 'revoked', expiresAt: NOW + 30 * 86400 },
        NOW + 0.5,
      ),
    ).toBe(NOW + 86400);
  });
});
