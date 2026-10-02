import { describe, it, expect } from '@rstest/core';
import { createHash } from 'node:crypto';
import { hashApiKeyForKey } from './hash-api-key-for-key';

describe('hashApiKeyForKey', () => {
  it('should return the sha256 hex digest', () => {
    expect(hashApiKeyForKey('tsk_secret')).toBe(
      createHash('sha256').update('tsk_secret').digest('hex'),
    );
  });

  it('should be stable', () => {
    expect(hashApiKeyForKey('abc')).toBe(hashApiKeyForKey('abc'));
  });

  it('should not contain the raw key', () => {
    expect(hashApiKeyForKey('tsk_secret')).not.toContain('tsk_secret');
  });

  it('should differ for different keys', () => {
    expect(hashApiKeyForKey('a')).not.toBe(hashApiKeyForKey('b'));
  });
});
