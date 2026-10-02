import { describe, it, expect } from '@rstest/core';
import { isPositiveSafeInteger } from './is-positive-safe-integer';

describe('isPositiveSafeInteger', () => {
  it('should accept integers from 1 to MAX_SAFE_INTEGER', () => {
    expect(isPositiveSafeInteger(1)).toBe(true);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('should reject zero, negatives, fractions, unsafe and non-numbers', () => {
    expect(isPositiveSafeInteger(0)).toBe(false);
    expect(isPositiveSafeInteger(-1)).toBe(false);
    expect(isPositiveSafeInteger(1.5)).toBe(false);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isPositiveSafeInteger('1')).toBe(false);
    expect(isPositiveSafeInteger(null)).toBe(false);
  });
});
