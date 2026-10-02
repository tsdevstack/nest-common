import { describe, it, expect } from '@rstest/core';
import { timingSafeStringEqual } from './timing-safe-string-equal';

describe('timingSafeStringEqual', () => {
  it('should return true for identical strings', () => {
    expect(timingSafeStringEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('should return false for different strings of the same length', () => {
    expect(timingSafeStringEqual('secret-tokeX', 'secret-token')).toBe(false);
  });

  it('should return false for different lengths', () => {
    expect(timingSafeStringEqual('secret', 'secret-token')).toBe(false);
  });

  it('should return false for an empty provided value', () => {
    expect(timingSafeStringEqual('', 'secret-token')).toBe(false);
  });
});
