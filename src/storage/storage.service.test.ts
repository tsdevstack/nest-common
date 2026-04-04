import { describe, it, expect } from '@rstest/core';
import { StorageService } from './storage.service';
import type { StorageProvider } from './storage.interface';

function createMockProvider(): StorageProvider {
  return {} as StorageProvider;
}

describe('StorageService', () => {
  describe('getProvider', () => {
    it('should return provider for registered bucket', () => {
      const mockProvider = createMockProvider();
      const map = new Map<string, StorageProvider>([['uploads', mockProvider]]);
      const service = new StorageService(map);

      expect(service.getProvider('uploads')).toBe(mockProvider);
    });

    it('should throw for unregistered bucket', () => {
      const map = new Map<string, StorageProvider>([
        ['uploads', createMockProvider()],
      ]);
      const service = new StorageService(map);

      expect(() => service.getProvider('unknown')).toThrow(
        'Storage bucket "unknown" is not registered',
      );
    });

    it('should list registered buckets in error message', () => {
      const map = new Map<string, StorageProvider>([
        ['uploads', createMockProvider()],
        ['avatars', createMockProvider()],
      ]);
      const service = new StorageService(map);

      expect(() => service.getProvider('missing')).toThrow(
        'Registered buckets: uploads, avatars',
      );
    });

    it('should show (none) when no buckets registered', () => {
      const service = new StorageService(new Map());

      expect(() => service.getProvider('anything')).toThrow(
        'Registered buckets: (none)',
      );
    });
  });

  describe('getRegisteredBuckets', () => {
    it('should return list of registered bucket names', () => {
      const map = new Map<string, StorageProvider>([
        ['uploads', createMockProvider()],
        ['avatars', createMockProvider()],
      ]);
      const service = new StorageService(map);

      expect(service.getRegisteredBuckets()).toEqual(['uploads', 'avatars']);
    });

    it('should return empty array when no buckets registered', () => {
      const service = new StorageService(new Map());
      expect(service.getRegisteredBuckets()).toEqual([]);
    });
  });
});
