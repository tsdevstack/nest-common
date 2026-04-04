import { Injectable } from '@nestjs/common';
import type { StorageProvider } from './storage.interface';

@Injectable()
export class StorageService {
  constructor(private readonly providers: Map<string, StorageProvider>) {}

  getProvider(bucketName: string): StorageProvider {
    const provider = this.providers.get(bucketName);

    if (!provider) {
      const registered = [...this.providers.keys()].join(', ') || '(none)';
      throw new Error(
        `Storage bucket "${bucketName}" is not registered. ` +
          `Registered buckets: ${registered}. ` +
          `Add "${bucketName}" to StorageModule.forRoot({ buckets: [...] }).`,
      );
    }

    return provider;
  }

  getRegisteredBuckets(): string[] {
    return [...this.providers.keys()];
  }
}
