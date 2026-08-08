import { describe, it, expect } from '@rstest/core';
import { hashEmailForKey } from './hash-email-for-key';

describe('hashEmailForKey', () => {
  describe('Standard use cases', () => {
    it('should produce a 32-char hex string', () => {
      expect(hashEmailForKey('user@example.com')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should be deterministic so the counter is stable', () => {
      expect(hashEmailForKey('user@example.com')).toBe(
        hashEmailForKey('user@example.com'),
      );
    });

    it('should produce different hashes for different addresses', () => {
      expect(hashEmailForKey('a@example.com')).not.toBe(
        hashEmailForKey('b@example.com'),
      );
    });

    it('should never contain the plaintext address', () => {
      expect(hashEmailForKey('user@example.com')).not.toContain('user');
      expect(hashEmailForKey('user@example.com')).not.toContain('@');
    });
  });

  describe('Normalization', () => {
    it('should treat casing as equivalent', () => {
      expect(hashEmailForKey('User@Example.COM')).toBe(
        hashEmailForKey('user@example.com'),
      );
    });

    it('should treat surrounding whitespace as equivalent', () => {
      expect(hashEmailForKey('  user@example.com  ')).toBe(
        hashEmailForKey('user@example.com'),
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle an empty string', () => {
      expect(hashEmailForKey('')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should handle unicode local parts', () => {
      expect(hashEmailForKey('üser@example.com')).toMatch(/^[0-9a-f]{32}$/);
    });
  });
});
