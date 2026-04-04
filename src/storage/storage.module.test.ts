import { describe, it, expect, rs, afterEach } from '@rstest/core';
import { StorageModule } from './storage.module';
import {
  STORAGE_BUCKET_PREFIX,
  STORAGE_CONFIG_TOKEN,
} from './storage.constants';
import { StorageService } from './storage.service';

// Mock SDKs to avoid real connections
rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = rs.fn();
    config = { region: 'us-east-1' };
  },
  GetObjectCommand: class {},
  PutObjectCommand: class {},
  DeleteObjectCommand: class {},
  HeadObjectCommand: class {},
  ListObjectsV2Command: class {},
  CopyObjectCommand: class {},
}));

rs.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {},
}));

rs.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: rs.fn(),
}));

rs.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket = rs.fn().mockReturnValue({});
  },
}));

rs.mock('@azure/storage-blob', () => ({
  BlobServiceClient: class {
    getContainerClient = rs.fn().mockReturnValue({});
    static fromConnectionString = rs.fn().mockReturnValue({
      getContainerClient: rs.fn().mockReturnValue({}),
    });
  },
  BlobSASPermissions: class {},
  generateBlobSASQueryParameters: rs.fn(),
  SASProtocol: { Https: 'https' },
}));

rs.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {},
}));

describe('StorageModule', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('forRoot', () => {
    it('should create a dynamic module with bucket providers', () => {
      const module = StorageModule.forRoot({ buckets: ['uploads', 'avatars'] });

      expect(module.module).toBe(StorageModule);
      expect(module.global).toBe(true);

      // Should have 1 config provider + 2 bucket providers + 1 StorageService provider
      expect(module.providers).toHaveLength(4);

      // Should export bucket tokens + StorageService (config provider is internal)
      expect(module.exports).toHaveLength(3);
      expect(module.exports).toContain(`${STORAGE_BUCKET_PREFIX}uploads`);
      expect(module.exports).toContain(`${STORAGE_BUCKET_PREFIX}avatars`);
      expect(module.exports).toContain(StorageService);
    });

    it('should create a shared config provider resolved once', () => {
      const module = StorageModule.forRoot({ buckets: ['uploads'] });

      const configProvider = module.providers![0] as {
        provide: string;
      };
      expect(configProvider.provide).toBe(STORAGE_CONFIG_TOKEN);
    });

    it('should create correct injection tokens for buckets', () => {
      const module = StorageModule.forRoot({ buckets: ['uploads'] });

      // providers[0] is config, providers[1] is first bucket
      const bucketProvider = module.providers![1] as {
        provide: string;
        inject: unknown[];
      };
      expect(bucketProvider.provide).toBe(`${STORAGE_BUCKET_PREFIX}uploads`);
    });

    it('should inject SecretsService and config into bucket factories', () => {
      const module = StorageModule.forRoot({ buckets: ['uploads'] });

      // providers[0] is config, providers[1] is first bucket
      const bucketProvider = module.providers![1] as {
        inject: unknown[];
      };
      expect(bucketProvider.inject).toContain(STORAGE_CONFIG_TOKEN);
    });
  });

  describe('forRootAsync', () => {
    it('should create a dynamic module with custom config', () => {
      const module = StorageModule.forRootAsync({
        buckets: [
          {
            name: 'uploads',
            adapter: 's3',
            cloudBucketName: 'my-project-uploads-dev',
            config: {
              endpoint: 'http://localhost:9000',
              forcePathStyle: true,
              credentials: { accessKey: 'test', secretKey: 'test' },
            },
          },
        ],
      });

      expect(module.module).toBe(StorageModule);
      expect(module.global).toBe(true);

      // 1 bucket provider + 1 StorageService
      expect(module.providers).toHaveLength(2);
      expect(module.exports).toContain(`${STORAGE_BUCKET_PREFIX}uploads`);
      expect(module.exports).toContain(StorageService);
    });

    it('should support multiple buckets with different adapters', () => {
      const module = StorageModule.forRootAsync({
        buckets: [
          {
            name: 'uploads',
            adapter: 's3',
            cloudBucketName: 'my-s3-bucket',
            config: {},
          },
          {
            name: 'backups',
            adapter: 'gcs',
            cloudBucketName: 'my-gcs-bucket',
            config: {},
          },
        ],
      });

      expect(module.providers).toHaveLength(3);
      expect(module.exports).toHaveLength(3);
    });
  });
});
