import { describe, it, expect } from '@rstest/core';
import { decodeApiKeyRecord } from './decode-api-key-record';
import { encodeApiKeyRecord } from './encode-api-key-record';

describe('decodeApiKeyRecord', () => {
  it('should round-trip with encodeApiKeyRecord', () => {
    const json =
      '{"v":1,"id":"key-1","consumer":"acme-corp","status":"active","limits":{"hour":1000},"expiresAt":1793491200}';
    expect(encodeApiKeyRecord(decodeApiKeyRecord(json))).toBe(json);
  });

  it('should reject invalid JSON', () => {
    expect(() => decodeApiKeyRecord('{"v":1,')).toThrow(/not valid JSON/);
  });

  it('should reject an unknown version', () => {
    expect(() =>
      decodeApiKeyRecord(
        '{"v":2,"id":"key-1","consumer":"acme-corp","status":"active","limits":{}}',
      ),
    ).toThrow(/v must be one of 1/);
  });
});
