import { describe, it, expect } from '@rstest/core';
import { parseUserinfoHeader } from './parse-userinfo-header';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64');

describe('parseUserinfoHeader', () => {
  describe('Standard use cases', () => {
    it('should map sub to id and copy the other claims', () => {
      const user = parseUserinfoHeader(
        encode({
          sub: 'user-123',
          email: 'user@example.com',
          roles: ['EDITOR'],
          confirmed: true,
          iat: 1700000000,
        }),
      );

      expect(user).toEqual({
        id: 'user-123',
        email: 'user@example.com',
        roles: ['EDITOR'],
        confirmed: true,
        iat: 1700000000,
      });
    });

    it('should not keep a sub property', () => {
      const user = parseUserinfoHeader(encode({ sub: 'user-1' }));
      expect(user).not.toHaveProperty('sub');
    });
  });

  describe('Unsafe claim names', () => {
    it('should skip __proto__, constructor and prototype claims', () => {
      const raw =
        '{"sub":"user-1","__proto__":{"polluted":true},"constructor":"x","prototype":"y","email":"a@b.c"}';
      const user = parseUserinfoHeader(Buffer.from(raw).toString('base64'));

      expect(user).toEqual({ id: 'user-1', email: 'a@b.c' });
      expect(Object.keys(user!)).toEqual(['id', 'email']);
      expect(Object.getPrototypeOf(user)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('Invalid input', () => {
    it('should return null for non-JSON content', () => {
      expect(parseUserinfoHeader('not-base64-json')).toBeNull();
    });

    it('should return null for plain (not base64) JSON', () => {
      expect(parseUserinfoHeader('{"sub":"user-1"}')).toBeNull();
    });

    it('should return null when sub is missing', () => {
      expect(parseUserinfoHeader(encode({ email: 'a@b.c' }))).toBeNull();
    });

    it('should return null when sub is not a string', () => {
      expect(parseUserinfoHeader(encode({ sub: 42 }))).toBeNull();
    });

    it('should return null when sub is empty', () => {
      expect(parseUserinfoHeader(encode({ sub: '' }))).toBeNull();
    });

    it('should return null for a JSON array', () => {
      expect(parseUserinfoHeader(encode(['user-1']))).toBeNull();
    });

    it('should return null for JSON null', () => {
      expect(parseUserinfoHeader(encode(null))).toBeNull();
    });
  });
});
