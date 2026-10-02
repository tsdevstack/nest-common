import { describe, it, expect } from '@rstest/core';
import { buildApiKeyRecordKey } from './build-api-key-record-key';

const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('buildApiKeyRecordKey', () => {
  it('should hash-tag the record key on the key hash', () => {
    expect(buildApiKeyRecordKey(HASH)).toBe(`apikey:{${HASH}}:rec`);
  });

  it('should refuse anything but a sha256 hex digest', () => {
    expect(() => buildApiKeyRecordKey('tsk_raw-key')).toThrow();
  });
});
