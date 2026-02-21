import { describe, it, expect } from '@rstest/core';
import { parseHeaderValue } from './parse-header-value';

describe('parseHeaderValue', () => {
  describe('Arrays (comma-separated values)', () => {
    it('should parse comma-separated values as array', () => {
      expect(parseHeaderValue('USER,ADMIN')).toEqual(['USER', 'ADMIN']);
      expect(parseHeaderValue('read,write,delete')).toEqual([
        'read',
        'write',
        'delete',
      ]);
    });

    it('should trim whitespace from array values', () => {
      expect(parseHeaderValue('USER, ADMIN, EDITOR')).toEqual([
        'USER',
        'ADMIN',
        'EDITOR',
      ]);
      expect(parseHeaderValue('read , write , delete')).toEqual([
        'read',
        'write',
        'delete',
      ]);
    });

    it('should handle single value with comma', () => {
      expect(parseHeaderValue('value,')).toEqual(['value', '']);
      expect(parseHeaderValue(',value')).toEqual(['', 'value']);
    });
  });

  describe('Numbers', () => {
    it('should parse numeric strings as numbers', () => {
      expect(parseHeaderValue('123')).toBe(123);
      expect(parseHeaderValue('0')).toBe(0);
      expect(parseHeaderValue('456789')).toBe(456789);
    });

    it('should NOT parse non-numeric strings as numbers', () => {
      expect(parseHeaderValue('123abc')).toBe('123abc');
      expect(parseHeaderValue('12.5')).toBe('12.5');
      expect(parseHeaderValue('-123')).toBe('-123');
      expect(parseHeaderValue('+123')).toBe('+123');
    });
  });

  describe('Booleans', () => {
    it('should parse "true" as boolean true', () => {
      expect(parseHeaderValue('true')).toBe(true);
    });

    it('should parse "false" as boolean false', () => {
      expect(parseHeaderValue('false')).toBe(false);
    });

    it('should NOT parse other boolean-like values', () => {
      expect(parseHeaderValue('True')).toBe('True');
      expect(parseHeaderValue('FALSE')).toBe('FALSE');
      expect(parseHeaderValue('1')).toBe(1); // Parsed as number
      expect(parseHeaderValue('0')).toBe(0); // Parsed as number
    });
  });

  describe('Strings', () => {
    it('should return strings as-is when no special parsing applies', () => {
      expect(parseHeaderValue('john@example.com')).toBe('john@example.com');
      expect(parseHeaderValue('Hello World')).toBe('Hello World');
      expect(parseHeaderValue('user-123')).toBe('user-123');
    });

    it('should handle empty string', () => {
      expect(parseHeaderValue('')).toBe('');
    });

    it('should handle special characters', () => {
      expect(parseHeaderValue('user@tenant#123')).toBe('user@tenant#123');
      expect(parseHeaderValue('/api/v1/users')).toBe('/api/v1/users');
    });
  });

  describe('Edge cases', () => {
    it('should prioritize array parsing over other types', () => {
      // Contains comma, so parsed as array even if values look like numbers
      expect(parseHeaderValue('1,2,3')).toEqual(['1', '2', '3']);
      expect(parseHeaderValue('true,false')).toEqual(['true', 'false']);
    });

    it('should handle whitespace-only values', () => {
      expect(parseHeaderValue(' ')).toBe(' ');
      expect(parseHeaderValue('   ')).toBe('   ');
    });
  });
});
