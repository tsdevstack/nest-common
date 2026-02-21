import { describe, it, expect } from '@rstest/core';
import { toCamelCase } from './to-camel-case';

describe('toCamelCase', () => {
  it('should convert kebab-case to camelCase', () => {
    expect(toCamelCase('tenant-id')).toBe('tenantId');
    expect(toCamelCase('is-verified')).toBe('isVerified');
    expect(toCamelCase('user-role-name')).toBe('userRoleName');
  });

  it('should handle single words without dashes', () => {
    expect(toCamelCase('email')).toBe('email');
    expect(toCamelCase('name')).toBe('name');
  });

  it('should handle multiple consecutive dashes', () => {
    expect(toCamelCase('user--id')).toBe('user-Id');
  });

  it('should handle empty string', () => {
    expect(toCamelCase('')).toBe('');
  });

  it('should only convert lowercase letters after dash', () => {
    // The regex /-([a-z])/g only matches lowercase letters after dash
    expect(toCamelCase('user-ID')).toBe('user-ID');
    expect(toCamelCase('User-name')).toBe('UserName'); // 'n' is lowercase, gets capitalized
  });

  it('should handle strings starting or ending with dash', () => {
    // Regex /-([a-z])/g matches dash followed by lowercase letter
    expect(toCamelCase('-user-id')).toBe('UserId'); // '-u' and '-i' get capitalized
    expect(toCamelCase('user-id-')).toBe('userId-'); // trailing dash ignored
  });
});
