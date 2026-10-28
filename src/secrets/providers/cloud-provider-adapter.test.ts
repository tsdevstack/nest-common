import { describe, it, expect, rs, beforeEach } from '@rstest/core';

import { CloudProviderAdapter } from './cloud-provider-adapter';
import type { CloudSecretsProvider } from './cloud-provider.interface';

describe('CloudProviderAdapter', () => {
  let adapter: CloudProviderAdapter;
  let mockCloudProvider: {
    read: ReturnType<typeof rs.fn>;
    getProviderName: ReturnType<typeof rs.fn>;
  };

  beforeEach(() => {
    rs.clearAllMocks();

    mockCloudProvider = {
      read: rs.fn(),
      getProviderName: rs.fn().mockReturnValue('gcp'),
    };

    adapter = new CloudProviderAdapter(
      mockCloudProvider as unknown as CloudSecretsProvider,
    );
  });

  describe('read', () => {
    it('should return the value of the scope from the cloud provider', async () => {
      mockCloudProvider.read.mockResolvedValue('secret-value');

      const result = await adapter.read('DATABASE_URL', 'auth-service');

      expect(result).toBe('secret-value');
      expect(mockCloudProvider.read).toHaveBeenCalledWith(
        'DATABASE_URL',
        'auth-service',
      );
    });

    it('should return null for a missing secret', async () => {
      mockCloudProvider.read.mockResolvedValue(null);

      await expect(adapter.read('MISSING_KEY', 'shared')).resolves.toBeNull();
    });
  });

  describe('getName', () => {
    it('should return provider name', () => {
      expect(adapter.getName()).toBe('gcp');
    });
  });
});
