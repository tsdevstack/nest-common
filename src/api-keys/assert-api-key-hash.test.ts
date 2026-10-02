import { describe, it, expect } from '@rstest/core';
import { assertApiKeyHash } from './assert-api-key-hash';

const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('assertApiKeyHash', () => {
  it('should accept a lowercase sha256 hex digest', () => {
    expect(() => assertApiKeyHash(HASH)).not.toThrow();
  });

  it('should reject raw keys, uppercase digests and wrong lengths', () => {
    expect(() => assertApiKeyHash('tsk_abc')).toThrow(/sha256 hex digest/);
    expect(() => assertApiKeyHash(HASH.toUpperCase())).toThrow();
    expect(() => assertApiKeyHash(HASH.slice(1))).toThrow();
    expect(() => assertApiKeyHash(`${HASH}0`)).toThrow();
    expect(() => assertApiKeyHash('')).toThrow();
  });
});
