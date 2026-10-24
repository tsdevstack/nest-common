import { describe, it, expect } from '@rstest/core';
import { buildServiceApiKeyName } from './build-service-api-key-name';

describe('buildServiceApiKeyName', () => {
  describe('Standard use cases', () => {
    it('should turn the service name into the stored key name', () => {
      expect(buildServiceApiKeyName('auth-service')).toBe(
        'AUTH_SERVICE_API_KEY',
      );
    });

    it('should replace every hyphen', () => {
      expect(buildServiceApiKeyName('user-management-v2-service')).toBe(
        'USER_MANAGEMENT_V2_SERVICE_API_KEY',
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle a name without hyphens', () => {
      expect(buildServiceApiKeyName('offers')).toBe('OFFERS_API_KEY');
    });
  });
});
