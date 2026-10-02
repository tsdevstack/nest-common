import { describe, it, expect } from '@rstest/core';
import { readHeader } from './read-header';

describe('readHeader', () => {
  it('should return a string header', () => {
    expect(readHeader({ 'x-a': 'value' }, 'x-a')).toBe('value');
  });

  it('should return undefined when the header is absent', () => {
    expect(readHeader({}, 'x-a')).toBeUndefined();
  });

  it('should join an array header like Node joins repeated headers', () => {
    expect(readHeader({ 'x-a': ['one', 'two'] }, 'x-a')).toBe('one, two');
  });

  it('should keep an empty string', () => {
    expect(readHeader({ 'x-a': '' }, 'x-a')).toBe('');
  });
});
