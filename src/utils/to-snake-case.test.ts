import { describe, it, expect } from '@rstest/core';
import { toSnakeCase } from './to-snake-case';

describe('toSnakeCase', () => {
  describe('Standard use cases', () => {
    it('should keep a single word', () => {
      expect(toSnakeCase('auth')).toBe('auth');
    });

    it('should convert a kebab-case name', () => {
      expect(toSnakeCase('auth-service')).toBe('auth_service');
    });
  });

  describe('Edge cases', () => {
    it('should handle an empty string', () => {
      expect(toSnakeCase('')).toBe('');
    });

    it('should keep capitals like the plain conversion', () => {
      expect(toSnakeCase('myApp')).toBe('myApp');
      expect(toSnakeCase('My-App')).toBe('My_App');
    });
  });

  describe('Same result as the plain conversion', () => {
    const inputs = [
      'auth-service',
      'payment-v2-service',
      'a--b',
      '1password-com',
      '-x',
      'x-',
      'a_b-c',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      'myApp',
      'My-App',
      'my.app',
    ];

    it.each(inputs)('should convert %j like the plain conversion', (input) => {
      expect(toSnakeCase(input)).toBe(input.replace(/-/g, '_'));
    });
  });
});
