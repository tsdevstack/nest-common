import { describe, it, expect, rs } from '@rstest/core';
import { createStorageProvider } from './provider-factory';
import type { StorageAdapterType } from './provider-factory';

// Mock all provider constructors to avoid real SDK initialization
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

describe('createStorageProvider', () => {
  describe('Standard use cases', () => {
    it('should create S3 provider', () => {
      const provider = createStorageProvider('s3', 'my-bucket', {});
      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('S3StorageProvider');
    });

    it('should create S3 provider with config', () => {
      const provider = createStorageProvider('s3', 'my-bucket', {
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        credentials: { accessKey: 'test', secretKey: 'test' },
      });
      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('S3StorageProvider');
    });

    it('should create GCS provider', () => {
      const provider = createStorageProvider('gcs', 'my-bucket', {});
      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('GCSStorageProvider');
    });

    it('should create Azure Blob provider', () => {
      const provider = createStorageProvider('azure-blob', 'my-bucket', {
        accountName: 'testaccount',
      });
      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('AzureBlobStorageProvider');
    });
  });

  describe('Edge cases', () => {
    it('should throw for unknown adapter type', () => {
      expect(() =>
        createStorageProvider('unknown' as StorageAdapterType, 'my-bucket', {}),
      ).toThrow('Unknown storage adapter: unknown');
    });
  });
});
