import { describe, it, expect } from '@rstest/core';
import { isPlainObject } from './is-plain-object';

describe('isPlainObject', () => {
  it('should accept objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('should reject null, arrays and primitives', () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('{}')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});
