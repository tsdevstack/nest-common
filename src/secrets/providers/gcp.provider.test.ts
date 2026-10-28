import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { GCPSecretsProvider } from './gcp.provider';
import type { CloudProviderConfig } from './cloud-provider.interface';

// Mock GCP Secret Manager client
const mockAccessSecretVersion = rs.fn();

// What the client throws for a missing secret (gRPC NOT_FOUND)
const NOT_FOUND = Object.assign(new Error('NOT_FOUND'), { code: 5 });

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = mockAccessSecretVersion;
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

  describe('read', () => {
    it('should read the exact name of the scope', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('shared-value') } },
      ]);

      const result = await provider.read('SOME_SECRET', 'shared');

      expect(result).toBe('shared-value');
      expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/gcp-project-123/secrets/testproject-shared-SOME_SECRET/versions/latest',
      });
    });

    it("should read the service's own scope by its name", async () => {
      mockAccessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('service-value') } },
      ]);

      await expect(provider.read('SOME_SECRET', 'test-service')).resolves.toBe(
        'service-value',
      );
      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/gcp-project-123/secrets/testproject-test-service-SOME_SECRET/versions/latest',
      });
    });

    it('should return null when the secret does not exist', async () => {
      mockAccessSecretVersion.mockRejectedValue(NOT_FOUND);

      await expect(provider.read('NONEXISTENT', 'shared')).resolves.toBeNull();
    });

    it('should throw, not report a missing secret, when access is denied', async () => {
      mockAccessSecretVersion.mockRejectedValue(
        Object.assign(new Error('PERMISSION_DENIED'), { code: 7 }),
      );

      await expect(provider.read('KEY', 'shared')).rejects.toThrow(
        'Failed to read secret testproject-shared-KEY from GCP: PERMISSION_DENIED',
      );
    });

    it('should handle empty payload data', async () => {
      mockAccessSecretVersion.mockResolvedValue([{ payload: {} }]);

      await expect(provider.read('KEY', 'shared')).resolves.toBeNull();
    });
  });

  describe('getProviderName', () => {
    it('should return "gcp"', () => {
      expect(provider.getProviderName()).toBe('gcp');
    });
  });
});
