import { describe, it, expect, rs, beforeEach } from '@rstest/core';

import { CloudProviderAdapter } from './cloud-provider-adapter';
import type { CloudSecretsProvider } from './cloud-provider.interface';

describe('CloudProviderAdapter', () => {
  let adapter: CloudProviderAdapter;
  let mockCloudProvider: {
    get: ReturnType<typeof rs.fn>;
    set: ReturnType<typeof rs.fn>;
    remove: ReturnType<typeof rs.fn>;
    list: ReturnType<typeof rs.fn>;
    exists: ReturnType<typeof rs.fn>;
    getProviderName: ReturnType<typeof rs.fn>;
  };

  beforeEach(() => {
    rs.clearAllMocks();

    mockCloudProvider = {
      get: rs.fn(),
      set: rs.fn(),
      remove: rs.fn(),
      list: rs.fn(),
      exists: rs.fn(),
      getProviderName: rs.fn().mockReturnValue('gcp'),
    };

    adapter = new CloudProviderAdapter(
      mockCloudProvider as unknown as CloudSecretsProvider,
      'auth-service',
    );
  });

  describe('get', () => {
    it('should return value from cloud provider', async () => {
      mockCloudProvider.get.mockResolvedValue('secret-value');

      const result = await adapter.get('DATABASE_URL');

      expect(result).toBe('secret-value');
      expect(mockCloudProvider.get).toHaveBeenCalledWith('DATABASE_URL');
    });

    it('should throw if value is null', async () => {
      mockCloudProvider.get.mockResolvedValue(null);

      await expect(adapter.get('MISSING_KEY')).rejects.toThrow(
        'Secret "MISSING_KEY" not found in gcp',
      );
    });

    it('should include service name in error message', async () => {
      mockCloudProvider.get.mockResolvedValue(null);

      await expect(adapter.get('KEY')).rejects.toThrow(
        'for service "auth-service"',
      );
    });
  });

  describe('getAll', () => {
    it('should fetch all listed secrets', async () => {
      mockCloudProvider.list.mockResolvedValue(['KEY1', 'KEY2']);
      mockCloudProvider.get
        .mockResolvedValueOnce('val1')
        .mockResolvedValueOnce('val2');

      const result = await adapter.getAll();

      expect(result).toEqual({ KEY1: 'val1', KEY2: 'val2' });
    });

    it('should skip secrets that return null', async () => {
      mockCloudProvider.list.mockResolvedValue(['KEY1', 'KEY2']);
      mockCloudProvider.get
        .mockResolvedValueOnce('val1')
        .mockResolvedValueOnce(null);

      const result = await adapter.getAll();

      expect(result).toEqual({ KEY1: 'val1' });
    });

    it('should skip secrets that throw errors', async () => {
      mockCloudProvider.list.mockResolvedValue(['KEY1', 'KEY2']);
      mockCloudProvider.get
        .mockResolvedValueOnce('val1')
        .mockRejectedValueOnce(new Error('Access denied'));

      const result = await adapter.getAll();

      expect(result).toEqual({ KEY1: 'val1' });
    });

    it('should return empty object when no secrets listed', async () => {
      mockCloudProvider.list.mockResolvedValue([]);

      const result = await adapter.getAll();

      expect(result).toEqual({});
    });
  });

  describe('set', () => {
    it('should call cloud provider set with metadata', async () => {
      mockCloudProvider.set.mockResolvedValue(undefined);

      await adapter.set('MY_KEY', 'my-value');

      expect(mockCloudProvider.set).toHaveBeenCalledWith('MY_KEY', 'my-value', {
        'secret-type': 'user',
        'managed-by': 'tsdevstack',
      });
    });
  });

  describe('delete', () => {
    it('should call cloud provider remove', async () => {
      mockCloudProvider.remove.mockResolvedValue(undefined);

      await adapter.delete('MY_KEY');

      expect(mockCloudProvider.remove).toHaveBeenCalledWith('MY_KEY');
    });
  });

  describe('getName', () => {
    it('should return provider name', () => {
      expect(adapter.getName()).toBe('gcp');
    });
  });

  describe('clearCache', () => {
    it('should not throw', () => {
      expect(() => adapter.clearCache()).not.toThrow();
    });
  });
});
