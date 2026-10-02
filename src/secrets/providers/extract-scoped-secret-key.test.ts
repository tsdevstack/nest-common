import { describe, it, expect } from '@rstest/core';
import { extractScopedSecretKey } from './extract-scoped-secret-key';
import {
  AZURE_SECRET_KEY_PATTERN,
  CLOUD_SECRET_KEY_PATTERN,
} from '../secrets.constants';

describe('extractScopedSecretKey', () => {
  const prefixes = ['tsdevstack-shared-', 'tsdevstack-auth-service-'];

  describe('Standard use cases', () => {
    it('should return the key of a shared secret', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-shared-JWT_SECRET',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBe('JWT_SECRET');
    });

    it('should return the key of a secret of the given service', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-auth-service-DATABASE_URL',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBe('DATABASE_URL');
    });

    it('should return null for a secret of another service', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-offers-service-DATABASE_URL',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should return null for a secret of another project', () => {
      expect(
        extractScopedSecretKey(
          'otherproject-shared-JWT_SECRET',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should return the hyphenated Azure key unchanged', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-shared-JWT-PRIVATE-KEY-CURRENT',
          prefixes,
          AZURE_SECRET_KEY_PATTERN,
        ),
      ).toBe('JWT-PRIVATE-KEY-CURRENT');
    });
  });

  describe('Edge cases', () => {
    it('should not take a longer service name as a key (auth vs auth-service)', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-auth-service-DATABASE_URL',
          ['tsdevstack-shared-', 'tsdevstack-auth-'],
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should not take a longer service name as a key (auth-service vs auth-service-v2)', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-auth-service-v2-DATABASE_URL',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should not take a longer Azure service name as a key', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-auth-service-2-DATABASE-URL',
          prefixes,
          AZURE_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should try the next prefix when the first one matches but leaves no key', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-auth-service-DATABASE_URL',
          ['tsdevstack-auth-', 'tsdevstack-auth-service-'],
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBe('DATABASE_URL');
    });

    it('should handle a project name with hyphens', () => {
      expect(
        extractScopedSecretKey(
          'my-app-auth-service-DATABASE_URL',
          ['my-app-shared-', 'my-app-auth-service-'],
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBe('DATABASE_URL');
    });

    it('should return null when nothing follows the prefix', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-shared-',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should return null for a hyphenated key on GCP/AWS', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-shared-DATABASE-URL',
          prefixes,
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });

    it('should return null when no prefixes are given', () => {
      expect(
        extractScopedSecretKey(
          'tsdevstack-shared-JWT_SECRET',
          [],
          CLOUD_SECRET_KEY_PATTERN,
        ),
      ).toBeNull();
    });
  });
});
