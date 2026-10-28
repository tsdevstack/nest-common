import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { SecretsProvider } from './secrets.interface';

// Mock providers - these need to be defined before rs.mock calls
const mockLocalProvider = {
  read: rs.fn(),
  getName: rs.fn().mockReturnValue('local'),
  setServiceName: rs.fn(),
};

const mockCloudProvider = {
  read: rs.fn(),
  getName: rs.fn().mockReturnValue('gcp'),
};

// Mock the local provider - must use class syntax for constructor
rs.mock('./providers/local.provider', () => ({
  LocalSecretsProvider: class MockLocalSecretsProvider {
    read = mockLocalProvider.read;
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
    read = mockCloudProvider.read;
    getName = mockCloudProvider.getName;
  },
}));

import { SecretsService } from './secrets.service';
import { SecretsProviderFactory } from './providers/provider-factory';

/**
 * A provider over an in-memory store: { scope: { KEY: value } }. An Error
 * as a scope makes every read of that scope fail with it.
 */
const memoryProvider = (
  scopes: Record<string, Record<string, string> | Error>,
  name = 'gcp',
) => {
  const read = rs.fn(async (key: string, scope: string) => {
    const entries = scopes[scope];
    if (entries instanceof Error) {
      throw entries;
    }
    return entries?.[key] ?? null;
  });
  const provider: SecretsProvider = {
    read,
    getName: () => name,
  };
  return { provider, read };
};

const serviceWith = (
  provider: SecretsProvider,
  serviceName = 'auth-service',
): SecretsService =>
  new SecretsService({ serviceName, forceProvider: provider });

describe('SecretsService', () => {
  const originalEnv = process.env;
  let now: ReturnType<typeof rs.spyOn> | undefined;

  // Pins Date.now() to `ms` for the cache period tests
  const setNow = (ms: number): void => {
    now ??= rs.spyOn(Date, 'now');
    now.mockReturnValue(ms);
  };

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    now?.mockRestore();
    now = undefined;
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
      const { provider } = memoryProvider({}, 'forced');

      const service = serviceWith(provider, 'test-service');

      expect(service.getProvider()).toBe(provider);
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
    describe('Standard use cases', () => {
      it("should return the service's own value over the shared one", async () => {
        const { provider } = memoryProvider({
          'auth-service': { LOG_LEVEL: 'debug' },
          shared: { LOG_LEVEL: 'info' },
        });

        await expect(serviceWith(provider).get('LOG_LEVEL')).resolves.toBe(
          'debug',
        );
      });

      it('should return the shared value when the service has none', async () => {
        const { provider } = memoryProvider({
          shared: { KONG_TRUST_TOKEN: 'trust-token' },
        });

        await expect(
          serviceWith(provider).get('KONG_TRUST_TOKEN'),
        ).resolves.toBe('trust-token');
      });

      it('should read both scopes of a key at once', async () => {
        const { provider, read } = memoryProvider({ shared: { KEY: 'v' } });

        await serviceWith(provider).get('KEY');

        expect(read).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenCalledWith('KEY', 'auth-service');
        expect(read).toHaveBeenCalledWith('KEY', 'shared');
      });

      it("should read API_KEY as this service's {SERVICE}_API_KEY", async () => {
        const { provider, read } = memoryProvider({
          shared: { AUTH_SERVICE_API_KEY: 'service-key' },
        });

        await expect(serviceWith(provider).get('API_KEY')).resolves.toBe(
          'service-key',
        );
        expect(read).toHaveBeenCalledWith('AUTH_SERVICE_API_KEY', 'shared');
        expect(read).not.toHaveBeenCalledWith('API_KEY', expect.anything());
      });

      it('should leave other keys ending in _API_KEY unchanged', async () => {
        const { provider, read } = memoryProvider({
          shared: { AUTH_SERVICE_API_KEY: 'other-key' },
        });

        await serviceWith(provider, 'bff-service').get('AUTH_SERVICE_API_KEY');

        expect(read).toHaveBeenCalledWith('AUTH_SERVICE_API_KEY', 'shared');
      });
    });

    describe('Errors', () => {
      it('should throw when neither scope has the key', async () => {
        const { provider } = memoryProvider({});

        await expect(serviceWith(provider).get('MISSING')).rejects.toThrow(
          'Secret "MISSING" not found in gcp for service "auth-service" or the shared scope.',
        );
      });

      it('should report a failed read as the failure, not as a missing key', async () => {
        const { provider } = memoryProvider({
          'auth-service': new Error('Failed to read secret: PERMISSION_DENIED'),
          shared: { KEY: 'v' },
        });

        await expect(serviceWith(provider).get('KEY')).rejects.toThrow(
          'PERMISSION_DENIED',
        );
      });

      it('should not cache a failed lookup', async () => {
        const scopes: Record<string, Record<string, string> | Error> = {
          shared: new Error('network'),
        };
        const { provider } = memoryProvider(scopes);
        const service = serviceWith(provider);

        await expect(service.get('KEY')).rejects.toThrow('network');
        scopes.shared = { KEY: 'v' };

        await expect(service.get('KEY')).resolves.toBe('v');
      });
    });

    describe('Caching', () => {
      it('should reuse a value within the cache period', async () => {
        const { provider, read } = memoryProvider({ shared: { KEY: 'v' } });
        const service = serviceWith(provider);

        await service.get('KEY');
        await service.get('KEY');

        expect(read).toHaveBeenCalledTimes(2); // one lookup, two scopes
      });

      it('should read again after 5 minutes in the cloud', async () => {
        setNow(1_000_000);
        const { provider, read } = memoryProvider({ shared: { KEY: 'v' } });
        const service = serviceWith(provider);

        await service.get('KEY');
        setNow(1_000_000 + 5 * 60 * 1000 - 1);
        await service.get('KEY');
        expect(read).toHaveBeenCalledTimes(2);

        setNow(1_000_000 + 5 * 60 * 1000 + 1);
        await service.get('KEY');
        expect(read).toHaveBeenCalledTimes(4);
      });

      it('should read again after 1 minute locally', async () => {
        setNow(1_000_000);
        const { provider, read } = memoryProvider(
          { shared: { KEY: 'v' } },
          'local',
        );
        const service = serviceWith(provider);

        await service.get('KEY');
        setNow(1_000_000 + 60 * 1000 + 1);
        await service.get('KEY');

        expect(read).toHaveBeenCalledTimes(4);
      });

      it('should share one lookup between concurrent reads of a key', async () => {
        const { provider, read } = memoryProvider({ shared: { KEY: 'v' } });
        const service = serviceWith(provider);

        const values = await Promise.all([
          service.get('KEY'),
          service.get('KEY'),
          service.get('KEY'),
        ]);

        expect(values).toEqual(['v', 'v', 'v']);
        expect(read).toHaveBeenCalledTimes(2);
      });

      it('should not cache URL values', async () => {
        const { provider, read } = memoryProvider({
          shared: { OFFERS_SERVICE_URL: 'https://offers.internal' },
        });
        const service = serviceWith(provider);

        await service.get('OFFERS_SERVICE_URL');
        await service.get('OFFERS_SERVICE_URL');

        expect(read).toHaveBeenCalledTimes(4);
      });

      it('should read again after clearCache', async () => {
        const { provider, read } = memoryProvider({ shared: { KEY: 'v' } });
        const service = serviceWith(provider);

        await service.get('KEY');
        service.clearCache();
        await service.get('KEY');

        expect(read).toHaveBeenCalledTimes(4);
      });
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
