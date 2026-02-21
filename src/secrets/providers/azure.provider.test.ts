import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { AzureSecretsProvider } from './azure.provider';
import type { CloudProviderConfig } from './cloud-provider.interface';

// Mock Azure SDK
const mockGetSecret = rs.fn();
const mockSetSecret = rs.fn();
const mockBeginDeleteSecret = rs.fn();
const mockListPropertiesOfSecrets = rs.fn();

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    getSecret = mockGetSecret;
    setSecret = mockSetSecret;
    beginDeleteSecret = mockBeginDeleteSecret;
    listPropertiesOfSecrets = mockListPropertiesOfSecrets;
  },
}));

rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class {
    constructor() {}
  },
}));

describe('AzureSecretsProvider', () => {
  let provider: AzureSecretsProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = {
      ...originalEnv,
      AZURE_TENANT_ID: 'test-tenant-id',
      AZURE_CLIENT_ID: 'test-client-id',
      AZURE_CLIENT_SECRET: 'test-client-secret',
    };

    const config: CloudProviderConfig = {
      projectName: 'testproject',
      serviceName: 'test-service',
      providerConfig: {
        keyVaultName: 'test-keyvault',
      },
    };

    provider = new AzureSecretsProvider(config);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should throw error when keyVaultName is missing from both env and config', () => {
      delete process.env.AZURE_KEYVAULT_NAME;

      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {},
      };

      expect(() => new AzureSecretsProvider(config)).toThrow(
        'Azure Key Vault name is required',
      );
    });

    it('should read keyVaultName from AZURE_KEYVAULT_NAME env var', () => {
      process.env.AZURE_KEYVAULT_NAME = 'env-keyvault';

      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {},
      };

      const p = new AzureSecretsProvider(config);
      expect(p.getProviderName()).toBe('azure');
    });

    it('should throw error when credentials are missing', () => {
      delete process.env.AZURE_TENANT_ID;

      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {
          keyVaultName: 'test-keyvault',
        },
      };

      expect(() => new AzureSecretsProvider(config)).toThrow(
        'Azure credentials are required',
      );
    });

    it('should initialize with valid config', () => {
      expect(provider.getProviderName()).toBe('azure');
    });
  });

  describe('get', () => {
    it('should get service-scoped secret', async () => {
      mockGetSecret.mockResolvedValue({ value: 'service-value' });

      const result = await provider.get('DATABASE_URL');

      expect(result).toBe('service-value');
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
    });

    it('should fall back to shared secret when service-scoped does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('Not found')) // service-scoped fails
        .mockResolvedValueOnce({ value: 'shared-value' }); // shared succeeds

      const result = await provider.get('API_KEY');

      expect(result).toBe('shared-value');
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
    });

    it('should return null when neither scope exists', async () => {
      mockGetSecret.mockRejectedValue(new Error('Not found'));

      const result = await provider.get('NONEXISTENT');

      expect(result).toBeNull();
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
    });

    it('should cache successful results', async () => {
      mockGetSecret.mockResolvedValue({ value: 'cached-value' });

      await provider.get('CACHED_KEY');
      await provider.get('CACHED_KEY');

      expect(mockGetSecret).toHaveBeenCalledTimes(1); // Only once due to cache
    });

    it('should transform key with underscores to hyphens', async () => {
      mockGetSecret.mockResolvedValue({ value: 'value' });

      await provider.get('DATABASE_URL');

      // Azure call should use hyphens instead of underscores
      expect(mockGetSecret).toHaveBeenCalledWith(
        'testproject-test-service-DATABASE-URL',
      );
    });

    it('should handle null value from Azure', async () => {
      mockGetSecret.mockResolvedValue({ value: null });

      const result = await provider.get('KEY');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set secret with tags', async () => {
      mockSetSecret.mockResolvedValue({});

      await provider.set('NEW_KEY', 'new-value');

      expect(mockSetSecret).toHaveBeenCalledWith(
        'testproject-test-service-NEW-KEY', // transformed name
        'new-value',
        expect.objectContaining({
          tags: expect.objectContaining({
            'project-name': 'testproject',
            'service-name': 'test-service',
            'managed-by': 'tsdevstack',
          }),
        }),
      );
    });

    it('should set secret with custom metadata', async () => {
      mockSetSecret.mockResolvedValue({});

      await provider.set('KEY', 'value', { environment: 'staging' });

      expect(mockSetSecret).toHaveBeenCalledWith(
        expect.any(String),
        'value',
        expect.objectContaining({
          tags: expect.objectContaining({
            environment: 'staging',
          }),
        }),
      );
    });

    it('should throw error on failure', async () => {
      mockSetSecret.mockRejectedValue(new Error('Permission denied'));

      await expect(provider.set('KEY', 'value')).rejects.toThrow(
        'Failed to set secret',
      );
    });

    it('should invalidate cache after set', async () => {
      // Cache a value
      mockGetSecret.mockResolvedValue({ value: 'old-value' });
      await provider.get('KEY');
      expect(mockGetSecret).toHaveBeenCalledTimes(1);

      // Set new value
      mockSetSecret.mockResolvedValue({});
      await provider.set('KEY', 'new-value');

      // Get should refetch
      mockGetSecret.mockResolvedValue({ value: 'new-value' });
      await provider.get('KEY');
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
    });
  });

  describe('remove', () => {
    it('should delete secret', async () => {
      const mockPoller = {
        pollUntilDone: rs.fn().mockResolvedValue({}),
      };
      mockBeginDeleteSecret.mockResolvedValue(mockPoller);

      await provider.remove('KEY_TO_DELETE');

      expect(mockBeginDeleteSecret).toHaveBeenCalledWith(
        'testproject-test-service-KEY-TO-DELETE',
      );
      expect(mockPoller.pollUntilDone).toHaveBeenCalled();
    });

    it('should throw error on failure', async () => {
      mockBeginDeleteSecret.mockRejectedValue(new Error('Permission denied'));

      await expect(provider.remove('KEY')).rejects.toThrow(
        'Failed to remove secret',
      );
    });
  });

  describe('list', () => {
    it('should list all secrets for project', async () => {
      const secretProperties = [
        {
          name: 'testproject-shared-DATABASE-URL',
          tags: { 'project-name': 'testproject' },
        },
        {
          name: 'testproject-test-service-API-KEY',
          tags: { 'project-name': 'testproject' },
        },
        {
          name: 'otherproject-shared-OTHER',
          tags: { 'project-name': 'otherproject' },
        },
      ];

      // Mock async iterator
      mockListPropertiesOfSecrets.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const prop of secretProperties) {
            yield prop;
          }
        },
      });

      const result = await provider.list();

      // Should only include testproject secrets and reverse transform hyphens to underscores
      expect(result).toEqual(['DATABASE_URL', 'API_KEY']);
    });

    it('should handle empty secret list', async () => {
      mockListPropertiesOfSecrets.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {},
      });

      const result = await provider.list();

      expect(result).toEqual([]);
    });

    it('should throw error on failure', async () => {
      mockListPropertiesOfSecrets.mockReturnValue({
        // eslint-disable-next-line require-yield
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Access denied');
        },
      });

      await expect(provider.list()).rejects.toThrow(
        'Failed to list secrets from Azure',
      );
    });
  });

  describe('exists', () => {
    it('should return true when service-scoped secret exists', async () => {
      mockGetSecret.mockResolvedValue({ value: 'value' });

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
    });

    it('should check shared scope if service-scoped does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('Not found')) // service-scoped
        .mockResolvedValueOnce({ value: 'shared-value' }); // shared

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
    });

    it('should return false when secret does not exist', async () => {
      mockGetSecret.mockRejectedValue(new Error('Not found'));

      const result = await provider.exists('NONEXISTENT');

      expect(result).toBe(false);
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProviderName', () => {
    it('should return "azure"', () => {
      expect(provider.getProviderName()).toBe('azure');
    });
  });

  describe('key transformation', () => {
    it('should transform underscores to hyphens for Azure compatibility', async () => {
      mockGetSecret.mockResolvedValue({ value: 'value' });

      await provider.get('DATABASE_URL_MAIN');

      expect(mockGetSecret).toHaveBeenCalledWith(
        'testproject-test-service-DATABASE-URL-MAIN',
      );
    });

    it('should reverse transform when extracting keys from list', async () => {
      mockListPropertiesOfSecrets.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            name: 'testproject-shared-DATABASE-URL-MAIN',
            tags: { 'project-name': 'testproject' },
          };
        },
      });

      const result = await provider.list();

      expect(result).toEqual(['DATABASE_URL_MAIN']);
    });
  });
});
