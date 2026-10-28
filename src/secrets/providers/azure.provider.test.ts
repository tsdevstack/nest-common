import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { AzureSecretsProvider } from './azure.provider';
import type { CloudProviderConfig } from './cloud-provider.interface';

// Mock Azure SDK
const mockGetSecret = rs.fn();
// Which vault each call went to: (vault URL, secret name)
const mockVaultCall = rs.fn();
const mockManagedIdentityCredential = rs.fn();

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    constructor(private readonly vaultUrl: string) {}
    getSecret = (name: string) => {
      mockVaultCall(this.vaultUrl, name);
      return mockGetSecret(name);
    };
  },
}));

rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class {
    constructor() {}
  },
  DefaultAzureCredential: class {
    constructor() {}
  },
  ManagedIdentityCredential: class {
    constructor(options: unknown) {
      mockManagedIdentityCredential(options);
    }
  },
}));

// What the SDK throws for a missing secret
const NOT_FOUND = Object.assign(new Error('SecretNotFound'), {
  statusCode: 404,
});

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

  describe('read', () => {
    it('should read the exact name of the scope', async () => {
      mockGetSecret.mockResolvedValue({ value: 'shared-value' });

      const result = await provider.read('SOME_SECRET', 'shared');

      expect(result).toBe('shared-value');
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
      expect(mockGetSecret).toHaveBeenCalledWith(
        'testproject-shared-SOME-SECRET',
      );
    });

    it("should read the service's own scope by its name", async () => {
      mockGetSecret.mockResolvedValue({ value: 'service-value' });

      await expect(provider.read('SOME_SECRET', 'test-service')).resolves.toBe(
        'service-value',
      );
      expect(mockGetSecret).toHaveBeenCalledWith(
        'testproject-test-service-SOME-SECRET',
      );
    });

    it('should return null when the secret does not exist', async () => {
      mockGetSecret.mockRejectedValue(NOT_FOUND);

      await expect(provider.read('NONEXISTENT', 'shared')).resolves.toBeNull();
    });

    it('should throw, not report a missing secret, when access is denied', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );

      await expect(provider.read('KEY', 'shared')).rejects.toThrow(
        'Failed to read secret testproject-shared-KEY from Azure: Forbidden',
      );
    });

    it('should transform key with underscores to hyphens', async () => {
      mockGetSecret.mockResolvedValue({ value: 'value' });

      await provider.read('DATABASE_URL_MAIN', 'shared');

      // Azure call should use hyphens instead of underscores
      expect(mockGetSecret).toHaveBeenCalledWith(
        'testproject-shared-DATABASE-URL-MAIN',
      );
    });

    it('should handle null value from Azure', async () => {
      mockGetSecret.mockResolvedValue({ value: null });

      await expect(provider.read('KEY', 'shared')).resolves.toBeNull();
    });
  });

  describe('getProviderName', () => {
    it('should return "azure"', () => {
      expect(provider.getProviderName()).toBe('azure');
    });
  });
  describe('vaults', () => {
    const config: CloudProviderConfig = {
      projectName: 'testproject',
      serviceName: 'test-service',
      providerConfig: { keyVaultName: 'test-keyvault' },
    };

    it('should read the shared scope from the shared vault and the own scope from the service vault', async () => {
      process.env.AZURE_SERVICE_KEYVAULT_NAME = 'test-service-vault';
      mockGetSecret.mockResolvedValue({ value: 'v' });
      const p = new AzureSecretsProvider(config);

      await p.read('KONG_TRUST_TOKEN', 'shared');
      await p.read('ADMIN_EMAILS', 'test-service');

      expect(mockVaultCall).toHaveBeenCalledWith(
        'https://test-keyvault.vault.azure.net',
        'testproject-shared-KONG-TRUST-TOKEN',
      );
      expect(mockVaultCall).toHaveBeenCalledWith(
        'https://test-service-vault.vault.azure.net',
        'testproject-test-service-ADMIN-EMAILS',
      );
    });

    it('should read the own scope from the shared vault for a container deployed by an older CLI', async () => {
      delete process.env.AZURE_SERVICE_KEYVAULT_NAME;
      mockGetSecret.mockResolvedValue({ value: 'v' });

      await new AzureSecretsProvider(config).read(
        'ADMIN_EMAILS',
        'test-service',
      );

      expect(mockVaultCall).toHaveBeenCalledWith(
        'https://test-keyvault.vault.azure.net',
        'testproject-test-service-ADMIN-EMAILS',
      );
    });

    it("should refuse to read another service's scope", async () => {
      await expect(
        new AzureSecretsProvider(config).read('ADMIN_EMAILS', 'auth-service'),
      ).rejects.toThrow(
        'Service "test-service" cannot read the secret scope "auth-service"',
      );
    });

    it("should use the service's own identity when AZURE_SECRETS_CLIENT_ID is set", () => {
      process.env.AZURE_SECRETS_CLIENT_ID = 'secrets-client-id';

      new AzureSecretsProvider(config);

      expect(mockManagedIdentityCredential).toHaveBeenCalledWith({
        clientId: 'secrets-client-id',
      });
    });
  });
});
