import { describe, it, expect } from '@rstest/core';
import { buildApiKeyLastUsedKey } from './build-api-key-last-used-key';

const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('buildApiKeyLastUsedKey', () => {
  it('should hash-tag the last-used key on the key hash', () => {
    expect(buildApiKeyLastUsedKey(HASH)).toBe(`apikey:{${HASH}}:lu`);
  });

  it('should refuse anything but a sha256 hex digest', () => {
    expect(() => buildApiKeyLastUsedKey('TEST')).toThrow();
  });
});
