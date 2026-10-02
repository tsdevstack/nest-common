import { describe, it, expect, rs, beforeEach } from '@rstest/core';

import { CloudProviderAdapter } from './cloud-provider-adapter';
import type { CloudSecretsProvider } from './cloud-provider.interface';
import { GCPSecretsProvider } from './gcp.provider';
import { AWSSecretsProvider } from './aws.provider';
import { AzureSecretsProvider } from './azure.provider';

// SDK mocks for the getAll tests that run a real provider under the adapter
const mockGcpListSecrets = rs.fn();
const mockGcpAccessSecretVersion = rs.fn();
const mockAwsSend = rs.fn();
const mockAzureListPropertiesOfSecrets = rs.fn();
const mockAzureGetSecret = rs.fn();

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    listSecrets = mockGcpListSecrets;
    accessSecretVersion = mockGcpAccessSecretVersion;
  },
}));

rs.mock('@aws-sdk/client-secrets-manager', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  return {
    SecretsManagerClient: class {
      send = mockAwsSend;
    },
    ListSecretsCommand: class extends Command {
      readonly kind = 'list';
    },
    GetSecretValueCommand: class extends Command {
      readonly kind = 'get';
    },
    CreateSecretCommand: Command,
    PutSecretValueCommand: Command,
    DeleteSecretCommand: Command,
    DescribeSecretCommand: Command,
  };
});

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    listPropertiesOfSecrets = mockAzureListPropertiesOfSecrets;
    getSecret = mockAzureGetSecret;
  },
}));

rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class {},
  DefaultAzureCredential: class {},
}));

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

  describe('getAll with a cloud provider', () => {
    // auth-service sees one shared secret and one of its own; the
    // offers-service secret must not be fetched at all
    const expected = {
      JWT_SECRET: 'jwt-value',
      ADMIN_EMAILS: 'admin@example.com',
    };

    it('should not fetch secrets of other services on GCP', async () => {
      const values: Record<string, string> = {
        'tsdevstack-shared-JWT_SECRET': 'jwt-value',
        'tsdevstack-offers-service-DATABASE_URL': 'offers-db',
        'tsdevstack-auth-service-ADMIN_EMAILS': 'admin@example.com',
      };
      mockGcpListSecrets.mockResolvedValue([
        Object.keys(values).map((id) => ({ name: `projects/p/secrets/${id}` })),
      ]);
      const fetched: string[] = [];
      mockGcpAccessSecretVersion.mockImplementation(
        async ({ name }: { name: string }) => {
          const secretId = name.split('/')[3];
          fetched.push(secretId);
          if (secretId in values) {
            return [{ payload: { data: Buffer.from(values[secretId]) } }];
          }
          throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
        },
      );
      const provider = new GCPSecretsProvider({
        projectName: 'tsdevstack',
        serviceName: 'auth-service',
        providerConfig: { projectId: 'gcp-project-123' },
      });

      const result = await new CloudProviderAdapter(
        provider,
        'auth-service',
      ).getAll();

      expect(result).toEqual(expected);
      expect(fetched).toEqual([
        'tsdevstack-shared-JWT_SECRET',
        'tsdevstack-shared-ADMIN_EMAILS',
        'tsdevstack-auth-service-ADMIN_EMAILS',
      ]);
    });

    it('should not fetch secrets of other services on AWS', async () => {
      const values: Record<string, string> = {
        'tsdevstack-shared-JWT_SECRET': 'jwt-value',
        'tsdevstack-offers-service-DATABASE_URL': 'offers-db',
        'tsdevstack-auth-service-ADMIN_EMAILS': 'admin@example.com',
      };
      const fetched: string[] = [];
      mockAwsSend.mockImplementation(
        async (command: { kind?: string; input: Record<string, unknown> }) => {
          if (command.kind === 'list') {
            return {
              SecretList: Object.keys(values).map((name) => ({ Name: name })),
            };
          }
          const secretId = String(command.input.SecretId);
          fetched.push(secretId);
          if (secretId in values) {
            return { SecretString: values[secretId] };
          }
          throw new Error('ResourceNotFoundException');
        },
      );
      const provider = new AWSSecretsProvider({
        projectName: 'tsdevstack',
        serviceName: 'auth-service',
        providerConfig: { region: 'us-east-1' },
      });

      const result = await new CloudProviderAdapter(
        provider,
        'auth-service',
      ).getAll();

      expect(result).toEqual(expected);
      expect(fetched).toEqual([
        'tsdevstack-shared-JWT_SECRET',
        'tsdevstack-shared-ADMIN_EMAILS',
        'tsdevstack-auth-service-ADMIN_EMAILS',
      ]);
    });

    it('should not fetch secrets of other services on Azure', async () => {
      const values: Record<string, string> = {
        'tsdevstack-shared-JWT-SECRET': 'jwt-value',
        'tsdevstack-offers-service-DATABASE-URL': 'offers-db',
        'tsdevstack-auth-service-ADMIN-EMAILS': 'admin@example.com',
      };
      mockAzureListPropertiesOfSecrets.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const name of Object.keys(values)) {
            yield { name, tags: { 'project-name': 'tsdevstack' } };
          }
        },
      });
      const fetched: string[] = [];
      mockAzureGetSecret.mockImplementation(async (name: string) => {
        fetched.push(name);
        if (name in values) {
          return { value: values[name] };
        }
        throw new Error('SecretNotFound');
      });
      const provider = new AzureSecretsProvider({
        projectName: 'tsdevstack',
        serviceName: 'auth-service',
        providerConfig: { keyVaultName: 'test-keyvault' },
      });

      const result = await new CloudProviderAdapter(
        provider,
        'auth-service',
      ).getAll();

      expect(result).toEqual(expected);
      expect(fetched).toEqual([
        'tsdevstack-shared-JWT-SECRET',
        'tsdevstack-shared-ADMIN-EMAILS',
        'tsdevstack-auth-service-ADMIN-EMAILS',
      ]);
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
