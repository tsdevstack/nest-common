import { describe, it, expect } from '@rstest/core';
import { userHasAnyRole } from './user-has-any-role';

describe('userHasAnyRole', () => {
  describe('System role', () => {
    it('should match systemRole', () => {
      expect(userHasAnyRole({ id: 'u', systemRole: 'ADMIN' }, ['ADMIN'])).toBe(
        true,
      );
    });

    it('should fall back to the legacy role claim', () => {
      expect(userHasAnyRole({ id: 'u', role: 'ADMIN' }, ['ADMIN'])).toBe(true);
    });

    it('should prefer systemRole over the legacy role claim', () => {
      expect(
        userHasAnyRole({ id: 'u', systemRole: 'USER', role: 'ADMIN' }, [
          'ADMIN',
        ]),
      ).toBe(false);
    });
  });

  describe('Custom roles', () => {
    it('should match a custom role', () => {
      expect(
        userHasAnyRole({ id: 'u', systemRole: 'USER', roles: ['EDITOR'] }, [
          'EDITOR',
        ]),
      ).toBe(true);
    });

    it('should match when any of several required roles is held', () => {
      expect(
        userHasAnyRole({ id: 'u', systemRole: 'USER', roles: ['BILLING'] }, [
          'ADMIN',
          'BILLING',
        ]),
      ).toBe(true);
    });

    it('should not treat a roles string as a list', () => {
      expect(userHasAnyRole({ id: 'u', roles: 'ADMIN' }, ['ADMIN'])).toBe(
        false,
      );
    });
  });

  describe('Missing roles', () => {
    it('should return false without a user', () => {
      expect(userHasAnyRole(undefined, ['ADMIN'])).toBe(false);
    });

    it('should return false when the user has no role claims', () => {
      expect(userHasAnyRole({ id: 'u' }, ['ADMIN'])).toBe(false);
    });

    it('should return false when the user lacks the role', () => {
      expect(
        userHasAnyRole({ id: 'u', systemRole: 'USER', roles: ['EDITOR'] }, [
          'ADMIN',
        ]),
      ).toBe(false);
    });

    it('should return false for an empty required list', () => {
      expect(userHasAnyRole({ id: 'u', systemRole: 'ADMIN' }, [])).toBe(false);
    });
  });
});
