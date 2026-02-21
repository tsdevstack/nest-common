import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { SecretsProvider } from './secrets.interface';

// Mock providers - these need to be defined before rs.mock calls
const mockLocalProvider = {
  get: rs.fn(),
  set: rs.fn(),
  delete: rs.fn(),
  clearCache: rs.fn(),
  getName: rs.fn().mockReturnValue('local'),
  setServiceName: rs.fn(),
};

const mockCloudProvider = {
  get: rs.fn(),
  set: rs.fn(),
  delete: rs.fn(),
  clearCache: rs.fn(),
  getName: rs.fn().mockReturnValue('gcp'),
};

// Mock the local provider - must use class syntax for constructor
rs.mock('./providers/local.provider', () => ({
  LocalSecretsProvider: class MockLocalSecretsProvider {
    get = mockLocalProvider.get;
    set = mockLocalProvider.set;
    delete = mockLocalProvider.delete;
    clearCache = mockLocalProvider.clearCache;
    getName = mockLocalProvider.getName;
    setServiceName = mockLocalProvider.setServiceName;
  },
}));

// Mock the provider factory
rs.mock('./providers/provider-factory', () => ({
  SecretsProviderFactory: {
    createProvider: rs.fn().mockReturnValue(null),
  },
}));

// Mock the cloud provider adapter - must use class syntax for constructor
rs.mock('./providers/cloud-provider-adapter', () => ({
  CloudProviderAdapter: class MockCloudProviderAdapter {
    get = mockCloudProvider.get;
    set = mockCloudProvider.set;
    delete = mockCloudProvider.delete;
    clearCache = mockCloudProvider.clearCache;
    getName = mockCloudProvider.getName;
  },
}));

import { SecretsService } from './secrets.service';
import { SecretsProviderFactory } from './providers/provider-factory';

describe('SecretsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should throw error when SECRETS_PROVIDER is not set', () => {
      delete process.env.SECRETS_PROVIDER;

      expect(() => new SecretsService({ serviceName: 'test-service' })).toThrow(
        'SECRETS_PROVIDER environment variable is required',
      );
    });

    it('should use local provider when SECRETS_PROVIDER is local', () => {
      process.env.SECRETS_PROVIDER = 'local';

      const service = new SecretsService({ serviceName: 'test-service' });
      const provider = service.getProvider();

      expect(provider.getName()).toBe('local');
      expect(mockLocalProvider.setServiceName).toHaveBeenCalledWith(
        'test-service',
      );
    });

    it('should use forced provider when specified', () => {
      process.env.SECRETS_PROVIDER = 'local';

      const forcedProvider: SecretsProvider = {
        get: rs.fn(),
        getAll: rs.fn(),
        set: rs.fn(),
        delete: rs.fn(),
        clearCache: rs.fn(),
        getName: () => 'forced',
      };

      const service = new SecretsService({
        serviceName: 'test-service',
        forceProvider: forcedProvider,
      });

      expect(service.getProvider()).toBe(forcedProvider);
    });

    it('should use cloud provider via factory when SECRETS_PROVIDER is gcp', () => {
      process.env.SECRETS_PROVIDER = 'gcp';
      (
        SecretsProviderFactory.createProvider as ReturnType<typeof rs.fn>
      ).mockReturnValue({});

      const service = new SecretsService({ serviceName: 'test-service' });
      const provider = service.getProvider();

      expect(provider.getName()).toBe('gcp');
    });
  });

  describe('get', () => {
    it('should delegate to provider.get', async () => {
      process.env.SECRETS_PROVIDER = 'local';
      (mockLocalProvider.get as ReturnType<typeof rs.fn>).mockResolvedValue(
        'secret-value',
      );

      const service = new SecretsService({ serviceName: 'test-service' });
      const result = await service.get('MY_SECRET');

      expect(mockLocalProvider.get).toHaveBeenCalledWith('MY_SECRET');
      expect(result).toBe('secret-value');
    });
  });

  describe('set', () => {
    it('should delegate to provider.set', async () => {
      process.env.SECRETS_PROVIDER = 'local';

      const service = new SecretsService({ serviceName: 'test-service' });
      await service.set('MY_SECRET', 'new-value');

      expect(mockLocalProvider.set).toHaveBeenCalledWith(
        'MY_SECRET',
        'new-value',
      );
    });
  });

  describe('delete', () => {
    it('should delegate to provider.delete', async () => {
      process.env.SECRETS_PROVIDER = 'local';

      const service = new SecretsService({ serviceName: 'test-service' });
      await service.delete('MY_SECRET');

      expect(mockLocalProvider.delete).toHaveBeenCalledWith('MY_SECRET');
    });
  });

  describe('clearCache', () => {
    it('should delegate to provider.clearCache', () => {
      process.env.SECRETS_PROVIDER = 'local';

      const service = new SecretsService({ serviceName: 'test-service' });
      service.clearCache();

      expect(mockLocalProvider.clearCache).toHaveBeenCalled();
    });
  });

  describe('getProvider', () => {
    it('should return the current provider', () => {
      process.env.SECRETS_PROVIDER = 'local';

      const service = new SecretsService({ serviceName: 'test-service' });
      const provider = service.getProvider();

      expect(provider).toBeDefined();
      expect(provider.getName()).toBe('local');
    });
  });
});
