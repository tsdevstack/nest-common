import { describe, it, expect } from '@rstest/core';
import { encodeApiKeyRecord } from './encode-api-key-record';
import type { ApiKeyRecord } from './api-key-record.interface';

describe('encodeApiKeyRecord', () => {
  it('should write fields and windows in a fixed order', () => {
    const record: ApiKeyRecord = {
      expiresAt: 1793491200,
      limits: { month: 100000, minute: 60, week: 5000 },
      status: 'active',
      consumer: 'acme-corp',
      id: 'key-1',
      v: 1,
    };
    expect(encodeApiKeyRecord(record)).toBe(
      '{"v":1,"id":"key-1","consumer":"acme-corp","status":"active","limits":{"minute":60,"week":5000,"month":100000},"expiresAt":1793491200}',
    );
  });

  it('should omit an absent expiry and keep empty limits as {}', () => {
    expect(
      encodeApiKeyRecord({
        v: 1,
        id: 'key-1',
        consumer: 'acme-corp',
        status: 'revoked',
        limits: {},
      }),
    ).toBe(
      '{"v":1,"id":"key-1","consumer":"acme-corp","status":"revoked","limits":{}}',
    );
  });

  it('should refuse a record that breaks the contract', () => {
    expect(() =>
      encodeApiKeyRecord({
        v: 1,
        id: 'key-1',
        consumer: 'acme corp',
        status: 'active',
        limits: { minute: -1 },
      }),
    ).toThrow(/Invalid API key record: consumer .*; limits.minute/);
  });
});
