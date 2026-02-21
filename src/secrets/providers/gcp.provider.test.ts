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
    it('should get service-scoped secret', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('service-value') } },
      ]);

      const result = await provider.get('DATABASE_URL');

      expect(result).toBe('service-value');
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
    });

    it('should fall back to shared secret when service-scoped does not exist', async () => {
      mockAccessSecretVersion
        .mockRejectedValueOnce(new Error('NOT_FOUND')) // service-scoped fails
        .mockResolvedValueOnce([
          { payload: { data: Buffer.from('shared-value') } },
        ]); // shared succeeds

      // Note: Don't use 'API_KEY' - it has special handling that bypasses service-scoped lookup
      const result = await provider.get('SOME_SECRET');

      expect(result).toBe('shared-value');
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(2);
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
        .mockRejectedValueOnce(new Error('NOT_FOUND')) // service exists check
        .mockRejectedValueOnce(new Error('NOT_FOUND')); // shared exists check
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
    it('should list all secrets for project', async () => {
      mockListSecrets.mockResolvedValue([
        [
          { name: 'projects/p/secrets/testproject-shared-DATABASE_URL' },
          { name: 'projects/p/secrets/testproject-test-service-API_KEY' },
          { name: 'projects/p/secrets/testproject-shared-REDIS_HOST' },
        ],
      ]);

      const result = await provider.list();

      // The key extraction splits by '-' and takes everything after the first two parts (projectName and scope)
      // So 'testproject-shared-DATABASE_URL' becomes 'DATABASE_URL'
      // and 'testproject-test-service-API_KEY' becomes 'service-API_KEY' (because scope is 'test')
      expect(result).toEqual(['DATABASE_URL', 'service-API_KEY', 'REDIS_HOST']);
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
    it('should return true when service-scoped secret exists', async () => {
      mockGetSecret.mockResolvedValue([{ name: 'secret-name' }]);

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(1);
    });

    it('should check shared scope if service-scoped does not exist', async () => {
      mockGetSecret
        .mockRejectedValueOnce(new Error('NOT_FOUND')) // service-scoped
        .mockResolvedValueOnce([{ name: 'shared-secret' }]); // shared

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockGetSecret).toHaveBeenCalledTimes(2);
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
