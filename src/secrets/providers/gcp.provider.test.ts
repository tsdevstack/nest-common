import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { GCPSecretsProvider } from './gcp.provider';
import type { CloudProviderConfig } from './cloud-provider.interface';

// Mock GCP Secret Manager client
const mockAccessSecretVersion = rs.fn();
const mockCreateSecret = rs.fn();
const mockAddSecretVersion = rs.fn();
const mockDeleteSecret = rs.fn();
const mockGetSecret = rs.fn();
const mockListSecrets = rs.fn();

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = mockAccessSecretVersion;
    createSecret = mockCreateSecret;
    addSecretVersion = mockAddSecretVersion;
    deleteSecret = mockDeleteSecret;
    getSecret = mockGetSecret;
    listSecrets = mockListSecrets;
  },
}));

describe('GCPSecretsProvider', () => {
  let provider: GCPSecretsProvider;

  beforeEach(() => {
    rs.resetAllMocks();

    const config: CloudProviderConfig = {
      projectName: 'testproject',
      serviceName: 'test-service',
      providerConfig: {
        projectId: 'gcp-project-123',
      },
    };

    provider = new GCPSecretsProvider(config);
  });

  describe('constructor', () => {
    it('should throw error when projectId is missing', () => {
      // Clear env var to test missing projectId
      const originalEnv = process.env.GCP_PROJECT_ID;
      delete process.env.GCP_PROJECT_ID;

      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {},
      };

      expect(() => new GCPSecretsProvider(config)).toThrow(
        'GCP_PROJECT_ID environment variable is required',
      );

      // Restore
      if (originalEnv) process.env.GCP_PROJECT_ID = originalEnv;
    });

    it('should initialize with valid config', () => {
      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {
          projectId: 'gcp-project-123',
        },
      };

      const provider = new GCPSecretsProvider(config);
      expect(provider.getProviderName()).toBe('gcp');
    });
  });

  describe('get', () => {
    it('should get shared secret with a single lookup', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('shared-value') } },
      ]);

      const result = await provider.get('SOME_SECRET');

      expect(result).toBe('shared-value');
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/gcp-project-123/secrets/testproject-shared-SOME_SECRET/versions/latest',
      });
    });

    it('should fall back to service-scoped secret when shared does not exist', async () => {
      mockAccessSecretVersion
        .mockRejectedValueOnce(new Error('NOT_FOUND')) // shared fails
        .mockResolvedValueOnce([
          { payload: { data: Buffer.from('service-value') } },
        ]); // service-scoped succeeds

      // Note: Don't use 'API_KEY' - it has special handling that bypasses the fallback chain
      const result = await provider.get('SOME_SECRET');

      expect(result).toBe('service-value');
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(2);
      expect(mockAccessSecretVersion).toHaveBeenNthCalledWith(2, {
        name: 'projects/gcp-project-123/secrets/testproject-test-service-SOME_SECRET/versions/latest',
      });
    });

    it('should return null when neither scope exists', async () => {
      mockAccessSecretVersion.mockRejectedValue(new Error('NOT_FOUND'));

      const result = await provider.get('NONEXISTENT');

      expect(result).toBeNull();
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(2);
    });

    it('should cache successful results', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('cached-value') } },
      ]);

      await provider.get('CACHED_KEY');
      await provider.get('CACHED_KEY');

      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1); // Only once due to cache
    });

    it('should handle empty payload data', async () => {
      mockAccessSecretVersion.mockResolvedValue([{ payload: {} }]);

      const result = await provider.get('KEY');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should create new secret when it does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('NOT_FOUND')) // shared exists check
        .mockRejectedValueOnce(new Error('NOT_FOUND')); // service exists check
      mockCreateSecret.mockResolvedValue([{}]);
      mockAddSecretVersion.mockResolvedValue([{}]);

      await provider.set('NEW_KEY', 'new-value');

      expect(mockCreateSecret).toHaveBeenCalledTimes(1);
      expect(mockAddSecretVersion).toHaveBeenCalledTimes(1);
    });

    it('should update existing secret without creating', async () => {
      mockGetSecret.mockResolvedValue([{ name: 'existing-secret' }]);
      mockAddSecretVersion.mockResolvedValue([{}]);

      await provider.set('EXISTING_KEY', 'updated-value');

      expect(mockCreateSecret).not.toHaveBeenCalled();
      expect(mockAddSecretVersion).toHaveBeenCalledTimes(1);
    });

    it('should set secret with metadata labels', async () => {
      mockGetSecret.mockRejectedValue(new Error('NOT_FOUND'));
      mockCreateSecret.mockResolvedValue([{}]);
      mockAddSecretVersion.mockResolvedValue([{}]);

      await provider.set('KEY', 'value', { environment: 'staging' });

      expect(mockCreateSecret).toHaveBeenCalledWith(
        expect.objectContaining({
          secret: expect.objectContaining({
            labels: expect.objectContaining({
              'project-name': 'testproject',
              'service-name': 'test-service',
              'managed-by': 'tsdevstack',
              environment: 'staging',
            }),
          }),
        }),
      );
    });

    it('should throw error on failure', async () => {
      mockGetSecret.mockRejectedValue(new Error('NOT_FOUND'));
      mockCreateSecret.mockRejectedValue(new Error('Permission denied'));

      await expect(provider.set('KEY', 'value')).rejects.toThrow(
        'Failed to set secret',
      );
    });
  });

  describe('remove', () => {
    it('should delete secret', async () => {
      mockDeleteSecret.mockResolvedValue([{}]);

      await provider.remove('KEY_TO_DELETE');

      expect(mockDeleteSecret).toHaveBeenCalledTimes(1);
    });

    it('should throw error on failure', async () => {
      mockDeleteSecret.mockRejectedValue(new Error('Permission denied'));

      await expect(provider.remove('KEY')).rejects.toThrow(
        'Failed to remove secret',
      );
    });
  });

  describe('list', () => {
    const createProvider = (
      projectName: string,
      serviceName: string,
    ): GCPSecretsProvider =>
      new GCPSecretsProvider({
        projectName,
        serviceName,
        providerConfig: { projectId: 'gcp-project-123' },
      });

    const mockSecretIds = (secretIds: string[]): void => {
      mockListSecrets.mockResolvedValue([
        secretIds.map((id) => ({ name: `projects/p/secrets/${id}` })),
      ]);
    };

    it('should list shared and own service-scoped keys', async () => {
      mockSecretIds([
        'testproject-shared-DATABASE_URL',
        'testproject-test-service-ADMIN_EMAILS',
        'testproject-shared-REDIS_HOST',
      ]);

      const result = await provider.list();

      expect(result).toEqual(['DATABASE_URL', 'ADMIN_EMAILS', 'REDIS_HOST']);
      expect(mockListSecrets).toHaveBeenCalledWith({
        parent: 'projects/gcp-project-123',
        filter: 'labels.project-name=testproject',
      });
    });

    it('should skip secrets of other services', async () => {
      mockSecretIds([
        'testproject-shared-JWT_SECRET',
        'testproject-offers-service-DATABASE_URL',
        'testproject-test-service-DATABASE_URL',
      ]);

      const result = await provider.list();

      expect(result).toEqual(['JWT_SECRET', 'DATABASE_URL']);
    });

    it('should not pick up secrets of a service whose name it prefixes (auth vs auth-service)', async () => {
      mockSecretIds([
        'testproject-auth-service-DATABASE_URL',
        'testproject-auth-ADMIN_EMAILS',
      ]);

      const result = await createProvider('testproject', 'auth').list();

      expect(result).toEqual(['ADMIN_EMAILS']);
    });

    it('should not pick up secrets of a service whose name it prefixes (auth-service vs auth-service-v2)', async () => {
      mockSecretIds([
        'testproject-auth-service-v2-DATABASE_URL',
        'testproject-auth-service-DATABASE_URL',
      ]);

      const result = await createProvider('testproject', 'auth-service').list();

      expect(result).toEqual(['DATABASE_URL']);
    });

    it('should handle a project name with hyphens', async () => {
      mockSecretIds([
        'my-app-shared-JWT_SECRET',
        'my-app-auth-service-DATABASE_URL',
        'my-app-offers-service-DATABASE_URL',
      ]);

      const result = await createProvider('my-app', 'auth-service').list();

      expect(result).toEqual(['JWT_SECRET', 'DATABASE_URL']);
    });

    it('should list a key present in both scopes once', async () => {
      mockSecretIds([
        'testproject-test-service-REDIS_HOST',
        'testproject-shared-REDIS_HOST',
      ]);

      const result = await provider.list();

      expect(result).toEqual(['REDIS_HOST']);
    });

    it('should list only shared keys when no service name is set', async () => {
      mockSecretIds([
        'testproject-shared-JWT_SECRET',
        'testproject-auth-service-DATABASE_URL',
      ]);

      const result = await createProvider('testproject', '').list();

      expect(result).toEqual(['JWT_SECRET']);
    });

    it('should handle empty secret list', async () => {
      mockListSecrets.mockResolvedValue([[]]);

      const result = await provider.list();

      expect(result).toEqual([]);
    });

    it('should throw error on failure', async () => {
      mockListSecrets.mockRejectedValue(new Error('Access denied'));

      await expect(provider.list()).rejects.toThrow(
        'Failed to list secrets from GCP',
      );
    });
  });

  describe('exists', () => {
    it('should return true when shared secret exists', async () => {
      mockGetSecret.mockResolvedValue([{ name: 'secret-name' }]);

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
      expect(mockGetSecret).toHaveBeenCalledWith({
        name: 'projects/gcp-project-123/secrets/testproject-shared-KEY',
      });
    });

    it('should check service scope if shared does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('NOT_FOUND')) // shared
        .mockResolvedValueOnce([{ name: 'service-secret' }]); // service-scoped

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
      expect(mockGetSecret).toHaveBeenNthCalledWith(2, {
        name: 'projects/gcp-project-123/secrets/testproject-test-service-KEY',
      });
    });

    it('should return false when secret does not exist', async () => {
      mockGetSecret.mockRejectedValue(new Error('NOT_FOUND'));

      const result = await provider.exists('NONEXISTENT');

      expect(result).toBe(false);
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProviderName', () => {
    it('should return "gcp"', () => {
      expect(provider.getProviderName()).toBe('gcp');
    });
  });

  describe('caching', () => {
    it('should cache values and not refetch within TTL', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('cached-value') } },
      ]);

      await provider.get('KEY');
      await provider.get('KEY');
      await provider.get('KEY');

      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache after set', async () => {
      // First, cache a value
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('old-value') } },
      ]);
      await provider.get('KEY');

      // Set a new value
      mockGetSecret.mockResolvedValue([{ name: 'exists' }]);
      mockAddSecretVersion.mockResolvedValue([{}]);
      await provider.set('KEY', 'new-value');

      // Get again should fetch from GCP
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('new-value') } },
      ]);
      const result = await provider.get('KEY');

      expect(result).toBe('new-value');
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(2);
    });
  });
});
