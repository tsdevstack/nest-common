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
  DefaultAzureCredential: class {
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

    it('should fall back to DefaultAzureCredential when AZURE_CLIENT_SECRET is missing', () => {
      delete process.env.AZURE_CLIENT_SECRET;

      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {
          keyVaultName: 'test-keyvault',
        },
      };

      // Should NOT throw — uses DefaultAzureCredential (managed identity)
      const p = new AzureSecretsProvider(config);
      expect(p.getProviderName()).toBe('azure');
    });

    it('should fall back to DefaultAzureCredential when AZURE_TENANT_ID is missing', () => {
      delete process.env.AZURE_TENANT_ID;

      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {
          keyVaultName: 'test-keyvault',
        },
      };

      // Should NOT throw — uses DefaultAzureCredential (managed identity)
      const p = new AzureSecretsProvider(config);
      expect(p.getProviderName()).toBe('azure');
    });

    it('should initialize with valid config', () => {
      expect(provider.getProviderName()).toBe('azure');
    });
  });

  describe('get', () => {
    it('should get shared secret with a single lookup', async () => {
      mockGetSecret.mockResolvedValue({ value: 'shared-value' });

      const result = await provider.get('SOME_SECRET');

      expect(result).toBe('shared-value');
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
      expect(mockGetSecret).toHaveBeenCalledWith(
        'testproject-shared-SOME-SECRET',
      );
    });

    it('should fall back to service-scoped secret when shared does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('Not found')) // shared fails
        .mockResolvedValueOnce({ value: 'service-value' }); // service-scoped succeeds

      const result = await provider.get('SOME_SECRET');

      expect(result).toBe('service-value');
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
      expect(mockGetSecret).toHaveBeenNthCalledWith(
        2,
        'testproject-test-service-SOME-SECRET',
      );
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
        'testproject-shared-DATABASE-URL',
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
    const createProvider = (
      projectName: string,
      serviceName: string,
    ): AzureSecretsProvider =>
      new AzureSecretsProvider({
        projectName,
        serviceName,
        providerConfig: { keyVaultName: 'test-keyvault' },
      });

    const mockSecretProperties = (
      secretProperties: Array<{ name: string; tags?: Record<string, string> }>,
    ): void => {
      mockListPropertiesOfSecrets.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const prop of secretProperties) {
            yield prop;
          }
        },
      });
    };

    // Secrets of one project, all tagged with its project name
    const mockProjectSecretNames = (
      projectName: string,
      names: string[],
    ): void => {
      mockSecretProperties(
        names.map((name) => ({ name, tags: { 'project-name': projectName } })),
      );
    };

    it('should list shared and own service-scoped keys of the project', async () => {
      mockSecretProperties([
        {
          name: 'testproject-shared-DATABASE-URL',
          tags: { 'project-name': 'testproject' },
        },
        {
          name: 'testproject-test-service-ADMIN-EMAILS',
          tags: { 'project-name': 'testproject' },
        },
        {
          name: 'otherproject-shared-OTHER',
          tags: { 'project-name': 'otherproject' },
        },
      ]);

      const result = await provider.list();

      // Should only include testproject secrets and reverse transform hyphens to underscores
      expect(result).toEqual(['DATABASE_URL', 'ADMIN_EMAILS']);
    });

    it('should skip secrets without the project-name tag', async () => {
      mockSecretProperties([
        { name: 'testproject-shared-JWT-SECRET' },
        {
          name: 'testproject-shared-REDIS-HOST',
          tags: { 'project-name': 'testproject' },
        },
      ]);

      const result = await provider.list();

      expect(result).toEqual(['REDIS_HOST']);
    });

    it('should skip secrets of other services', async () => {
      mockProjectSecretNames('tsdevstack', [
        'tsdevstack-shared-JWT-SECRET',
        'tsdevstack-offers-service-DATABASE-URL',
        'tsdevstack-auth-service-DATABASE-URL',
      ]);

      const result = await createProvider('tsdevstack', 'auth-service').list();

      // Not SERVICE_DATABASE_URL from the offers-service secret
      expect(result).toEqual(['JWT_SECRET', 'DATABASE_URL']);
    });

    it('should not pick up secrets of a service whose name it prefixes (auth vs auth-service)', async () => {
      mockProjectSecretNames('testproject', [
        'testproject-auth-service-DATABASE-URL',
        'testproject-auth-ADMIN-EMAILS',
      ]);

      const result = await createProvider('testproject', 'auth').list();

      expect(result).toEqual(['ADMIN_EMAILS']);
    });

    it('should not pick up secrets of a service whose name it prefixes (auth-service vs auth-service-v2)', async () => {
      mockProjectSecretNames('testproject', [
        'testproject-auth-service-v2-DATABASE-URL',
        'testproject-auth-service-DATABASE-URL',
      ]);

      const result = await createProvider('testproject', 'auth-service').list();

      expect(result).toEqual(['DATABASE_URL']);
    });

    it('should handle a project name with hyphens', async () => {
      mockProjectSecretNames('my-app', [
        'my-app-shared-JWT-SECRET',
        'my-app-auth-service-DATABASE-URL',
        'my-app-offers-service-DATABASE-URL',
      ]);

      const result = await createProvider('my-app', 'auth-service').list();

      expect(result).toEqual(['JWT_SECRET', 'DATABASE_URL']);
    });

    it('should reverse every hyphen of a multi-hyphen key', async () => {
      mockProjectSecretNames('testproject', [
        'testproject-shared-JWT-PRIVATE-KEY-CURRENT',
        'testproject-test-service-AUTH-SERVICE-API-KEY-2',
      ]);

      const result = await provider.list();

      expect(result).toEqual([
        'JWT_PRIVATE_KEY_CURRENT',
        'AUTH_SERVICE_API_KEY_2',
      ]);
    });

    it('should list a key present in both scopes once', async () => {
      mockProjectSecretNames('testproject', [
        'testproject-test-service-REDIS-HOST',
        'testproject-shared-REDIS-HOST',
      ]);

      const result = await provider.list();

      expect(result).toEqual(['REDIS_HOST']);
    });

    it('should list only shared keys when no service name is set', async () => {
      mockProjectSecretNames('testproject', [
        'testproject-shared-JWT-SECRET',
        'testproject-auth-service-DATABASE-URL',
      ]);

      const result = await createProvider('testproject', '').list();

      expect(result).toEqual(['JWT_SECRET']);
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
    it('should return true when shared secret exists', async () => {
      mockGetSecret.mockResolvedValue({ value: 'value' });

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
    });

    it('should check service scope if shared does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('Not found')) // shared
        .mockResolvedValueOnce({ value: 'service-value' }); // service-scoped

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
        'testproject-shared-DATABASE-URL-MAIN',
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
