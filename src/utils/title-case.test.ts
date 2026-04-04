import { describe, it, expect } from '@rstest/core';
import { titleCase } from './title-case';

describe('titleCase', () => {
  it('should convert kebab-case to title case', () => {
    expect(titleCase('auth-service')).toBe('Auth Service');
  });

  it('should handle single word', () => {
    expect(titleCase('frontend')).toBe('Frontend');
  });

  it('should handle multiple hyphens', () => {
    expect(titleCase('my-cool-service')).toBe('My Cool Service');
  });
});
