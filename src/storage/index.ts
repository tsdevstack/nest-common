// Storage Module
export { StorageModule } from './storage.module';
export type {
  StorageModuleOptions,
  StorageModuleAsyncOptions,
} from './storage.module';

// Storage Service
export { StorageService } from './storage.service';

// Decorator
export { InjectStorage } from './storage.decorator';

// Interfaces
export type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  DownloadOptions,
  DownloadResult,
  ListOptions,
  ObjectInfo,
  ObjectMetadata,
  PresignedUrlOptions,
  CopyOptions,
  CopyResult,
} from './storage.interface';

// Errors
export { StorageError, StorageErrorCode } from './storage-error';

// Provider Factory
export { createStorageProvider } from './providers/provider-factory';
export type {
  StorageAdapterType,
  StorageProviderConfig,
} from './providers/provider-factory';

// Provider implementations (for direct use in forRootAsync)
export { S3StorageProvider } from './providers/s3.provider';
export type { S3ProviderConfig } from './providers/s3.provider';
export { GCSStorageProvider } from './providers/gcs.provider';
export type { GCSProviderConfig } from './providers/gcs.provider';
export { AzureBlobStorageProvider } from './providers/azure-blob.provider';
export type { AzureBlobProviderConfig } from './providers/azure-blob.provider';
