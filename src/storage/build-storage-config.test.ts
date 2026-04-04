import { describe, it, expect, rs, afterEach } from '@rstest/core';
import { buildStorageConfig } from './build-storage-config';

// Mock SecretsService — only `get` is needed by buildStorageConfig
function createMockSecrets(secrets: Record<string, string>): {
  get: (key: string) => Promise<string>;
} {
  return {
    get: rs.fn().mockImplementation(async (key: string) => {
      const value = secrets[key];
      if (value === undefined) {
        throw new Error(`Secret not found: ${key}`);
      }
      return value;
    }),
  };
}

describe('buildStorageConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('S3 adapter', () => {
    it('should return MinIO config when SECRETS_PROVIDER=local', async () => {
      process.env.SECRETS_PROVIDER = 'local';

      const secrets = createMockSecrets({
        STORAGE_ENDPOINT: 'http://localhost:9000',
        STORAGE_ACCESS_KEY: 'minioadmin',
        STORAGE_SECRET_KEY: 'minioadmin',
        STORAGE_FORCE_PATH_STYLE: 'true',
      });

      const config = await buildStorageConfig(secrets, 's3');

      expect(config).toEqual({
        endpoint: 'http://localhost:9000',
        credentials: { accessKey: 'minioadmin', secretKey: 'minioadmin' },
        forcePathStyle: true,
      });
    });

    it('should return empty config for AWS (IAM handles auth)', async () => {
      process.env.SECRETS_PROVIDER = 'aws';

      const secrets = createMockSecrets({});
      const config = await buildStorageConfig(secrets, 's3');

      expect(config).toEqual({});
    });
  });

  describe('GCS adapter', () => {
    it('should return empty config (ADC handles auth)', async () => {
      const secrets = createMockSecrets({});
      const config = await buildStorageConfig(secrets, 'gcs');

      expect(config).toEqual({});
    });
  });

  describe('Azure Blob adapter', () => {
    it('should return config with account name from env', async () => {
      process.env.AZURE_STORAGE_ACCOUNT_NAME = 'myaccount';

      const secrets = createMockSecrets({});
      const config = await buildStorageConfig(secrets, 'azure-blob');

      expect(config).toEqual({ accountName: 'myaccount' });
    });

    it('should throw when AZURE_STORAGE_ACCOUNT_NAME is missing', async () => {
      delete process.env.AZURE_STORAGE_ACCOUNT_NAME;

      const secrets = createMockSecrets({});

      await expect(buildStorageConfig(secrets, 'azure-blob')).rejects.toThrow(
        'AZURE_STORAGE_ACCOUNT_NAME',
      );
    });
  });
});
