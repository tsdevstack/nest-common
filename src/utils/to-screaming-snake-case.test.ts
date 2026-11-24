import { describe, it, expect } from '@rstest/core';
import { toScreamingSnakeCase } from './to-screaming-snake-case';

describe('toScreamingSnakeCase', () => {
  describe('Standard use cases', () => {
    it('should convert a single word', () => {
      expect(toScreamingSnakeCase('uploads')).toBe('UPLOADS');
    });

    it('should convert a kebab-case name', () => {
      expect(toScreamingSnakeCase('auth-service')).toBe('AUTH_SERVICE');
    });

    it('should keep digits in place', () => {
      expect(toScreamingSnakeCase('payment-v2-service')).toBe(
        'PAYMENT_V2_SERVICE',
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle an empty string', () => {
      expect(toScreamingSnakeCase('')).toBe('');
    });

    it('should convert consecutive hyphens', () => {
      expect(toScreamingSnakeCase('a--b')).toBe('A__B');
    });

    it('should convert names with capitals like the plain conversion', () => {
      expect(toScreamingSnakeCase('myApp')).toBe('MYAPP');
    });
  });

  describe('Same result as the plain conversion', () => {
    const inputs = [
      'auth-service',
      'api-2-service',
      'a--b',
      '1password-com',
      '-x',
      'x-',
      'a_b-c',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      'Example-com',
      'myApp',
      'USER_ID',
      'api.service',
    ];

    it.each(inputs)('should convert %j like the plain conversion', (input) => {
      expect(toScreamingSnakeCase(input)).toBe(
        input.replace(/-/g, '_').toUpperCase(),
      );
    });
  });
});
