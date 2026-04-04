import type { StorageProvider } from '../storage.interface';
import { S3StorageProvider } from './s3.provider';
import type { S3ProviderConfig } from './s3.provider';
import { GCSStorageProvider } from './gcs.provider';
import type { GCSProviderConfig } from './gcs.provider';
import { AzureBlobStorageProvider } from './azure-blob.provider';
import type { AzureBlobProviderConfig } from './azure-blob.provider';

export type StorageAdapterType = 's3' | 'gcs' | 'azure-blob';

export type StorageProviderConfig =
  | Omit<S3ProviderConfig, 'bucket'>
  | Omit<GCSProviderConfig, 'bucket'>
  | Omit<AzureBlobProviderConfig, 'bucket'>;

export function createStorageProvider(
  adapter: StorageAdapterType,
  bucketName: string,
  config: StorageProviderConfig,
): StorageProvider {
  switch (adapter) {
    case 's3':
      return new S3StorageProvider({
        bucket: bucketName,
        ...(config as Omit<S3ProviderConfig, 'bucket'>),
      });
    case 'gcs':
      return new GCSStorageProvider({
        bucket: bucketName,
        ...(config as Omit<GCSProviderConfig, 'bucket'>),
      });
    case 'azure-blob':
      return new AzureBlobStorageProvider({
        bucket: bucketName,
        ...(config as Omit<AzureBlobProviderConfig, 'bucket'>),
      });
    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown storage adapter: ${exhaustive}`);
    }
  }
}
