import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import {
  STORAGE_BUCKET_PREFIX,
  STORAGE_CONFIG_TOKEN,
} from './storage.constants';
import { StorageService } from './storage.service';
import { createStorageProvider } from './providers/provider-factory';
import type {
  StorageAdapterType,
  StorageProviderConfig,
} from './providers/provider-factory';
import type { StorageProvider } from './storage.interface';
import { buildStorageConfig } from './build-storage-config';

export interface StorageModuleOptions {
  buckets: string[];
}

export interface StorageModuleAsyncOptions {
  buckets: {
    name: string;
    adapter: StorageAdapterType;
    config: StorageProviderConfig;
    cloudBucketName: string;
  }[];
}

interface StorageConfigResult {
  adapter: StorageAdapterType;
  config: StorageProviderConfig;
}

function deriveStorageAdapter(): StorageAdapterType {
  const secretsProvider = process.env.SECRETS_PROVIDER;

  if (!secretsProvider) {
    throw new Error('SECRETS_PROVIDER env var is required for StorageModule');
  }

  if (secretsProvider === 'gcp') {
    return 'gcs';
  }

  if (secretsProvider === 'azure') {
    return 'azure-blob';
  }

  // covers 'aws' and 'local' (MinIO)
  return 's3';
}

@Module({})
export class StorageModule {
  static forRoot(options: StorageModuleOptions): DynamicModule {
    const configProvider: Provider = {
      provide: STORAGE_CONFIG_TOKEN,
      useFactory: async (
        secrets: SecretsService,
      ): Promise<StorageConfigResult> => {
        const adapter = deriveStorageAdapter();
        const config = await buildStorageConfig(secrets, adapter);
        return { adapter, config };
      },
      inject: [SecretsService],
    };

    const bucketProviders: Provider[] = options.buckets.map((bucket) => ({
      provide: `${STORAGE_BUCKET_PREFIX}${bucket}`,
      useFactory: async (
        secrets: SecretsService,
        storageConfig: StorageConfigResult,
      ): Promise<StorageProvider> => {
        const bucketEnvKey = `STORAGE_BUCKET_${bucket.replace(/-/g, '_').toUpperCase()}`;
        const cloudBucketName = await secrets.get(bucketEnvKey);

        return createStorageProvider(
          storageConfig.adapter,
          cloudBucketName,
          storageConfig.config,
        );
      },
      inject: [SecretsService, STORAGE_CONFIG_TOKEN],
    }));

    const storageServiceProvider: Provider = {
      provide: StorageService,
      useFactory: (...instances: StorageProvider[]): StorageService => {
        const map = new Map<string, StorageProvider>();
        options.buckets.forEach((bucket, i) => map.set(bucket, instances[i]));
        return new StorageService(map);
      },
      inject: options.buckets.map((b) => `${STORAGE_BUCKET_PREFIX}${b}`),
    };

    return {
      module: StorageModule,
      providers: [configProvider, ...bucketProviders, storageServiceProvider],
      exports: [
        ...bucketProviders.map((p) => (p as { provide: string }).provide),
        StorageService,
      ],
      global: true,
    };
  }

  static forRootAsync(options: StorageModuleAsyncOptions): DynamicModule {
    const bucketProviders: Provider[] = options.buckets.map((bucket) => ({
      provide: `${STORAGE_BUCKET_PREFIX}${bucket.name}`,
      useFactory: (): StorageProvider =>
        createStorageProvider(
          bucket.adapter,
          bucket.cloudBucketName,
          bucket.config,
        ),
    }));

    const storageServiceProvider: Provider = {
      provide: StorageService,
      useFactory: (...instances: StorageProvider[]): StorageService => {
        const map = new Map<string, StorageProvider>();
        options.buckets.forEach((bucket, i) =>
          map.set(bucket.name, instances[i]),
        );
        return new StorageService(map);
      },
      inject: options.buckets.map((b) => `${STORAGE_BUCKET_PREFIX}${b.name}`),
    };

    return {
      module: StorageModule,
      providers: [...bucketProviders, storageServiceProvider],
      exports: [
        ...bucketProviders.map((p) => (p as { provide: string }).provide),
        StorageService,
      ],
      global: true,
    };
  }
}
