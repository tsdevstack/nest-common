import { describe, it, expect } from '@rstest/core';
import { createHash } from 'node:crypto';
import { hashApiKey } from './hash-api-key';

describe('hashApiKey', () => {
  it('should return the sha256 hex digest Kong computes (kong.tools.sha256.sha256_hex)', () => {
    expect(hashApiKey('test')).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
  });

  it('should hash the exact value, including the prefix', () => {
    const key = 'tsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toBe(hashApiKey(key.slice(4)));
  });

  it('should hash UTF-8 bytes', () => {
    // sha256 of the two bytes c3 a9 ("é" in UTF-8)
    expect(hashApiKey('é')).toBe(
      createHash('sha256').update(Buffer.from('c3a9', 'hex')).digest('hex'),
    );
  });
});
