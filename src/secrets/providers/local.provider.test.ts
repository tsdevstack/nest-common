import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

// Mock fs module
rs.mock('fs', () => ({
  existsSync: rs.fn(),
  readFileSync: rs.fn(),
}));

import * as fs from 'fs';
import { LocalSecretsProvider } from './local.provider';

describe('LocalSecretsProvider', () => {
  // What generate-secrets writes: shared values in the top-level `secrets`
  // block, each service's own in its section (plus non-string entries)
  const mockSecrets = {
    'auth-service': {
      DATABASE_URL: 'postgresql://localhost:5432/auth',
      JWT_SECRET: 'auth-jwt-secret',
      secrets: ['JWT_SECRET'],
    },
    secrets: {
      NODE_ENV: 'development',
      REDIS_PASSWORD: 'redis-password',
    },
  };

  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };

    // Default mock implementations
    (fs.existsSync as ReturnType<typeof rs.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof rs.fn>).mockReturnValue(
      JSON.stringify(mockSecrets),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should find secrets file in project root', () => {
      new LocalSecretsProvider('.secrets.local.json');
      expect(fs.existsSync).toHaveBeenCalled();
    });

    it('should throw error when secrets file not found', () => {
      (fs.existsSync as ReturnType<typeof rs.fn>).mockReturnValue(false);

      expect(() => new LocalSecretsProvider('.secrets.local.json')).toThrow(
        'Secrets file not found',
      );
    });

    it('should throw error for invalid JSON', () => {
      (fs.readFileSync as ReturnType<typeof rs.fn>).mockReturnValue(
        'invalid json',
      );

      expect(() => new LocalSecretsProvider('.secrets.local.json')).toThrow(
        'JSON syntax error',
      );
    });

    it('should throw error for non-object secrets file', () => {
      (fs.readFileSync as ReturnType<typeof rs.fn>).mockReturnValue('"string"');

      expect(() => new LocalSecretsProvider('.secrets.local.json')).toThrow(
        'Invalid secrets file format',
      );
    });

    it('should inject NODE_ENV into process.env', () => {
      new LocalSecretsProvider('.secrets.local.json');
      expect(process.env.NODE_ENV).toBe('development');
    });
  });

  describe('setServiceName', () => {
    it('should set service name for scoped access', () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('auth-service');
      expect(process.env.DATABASE_URL).toBe('postgresql://localhost:5432/auth');
    });

    it('should not set DATABASE_URL if service has none', () => {
      const secretsWithoutDb = {
        'other-service': {
          API_KEY: 'some-key',
        },
      };
      (fs.readFileSync as ReturnType<typeof rs.fn>).mockReturnValue(
        JSON.stringify(secretsWithoutDb),
      );
      delete process.env.DATABASE_URL;

      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('other-service');
      expect(process.env.DATABASE_URL).toBeUndefined();
    });
  });

  describe('read', () => {
    it("should read the service's own section", async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');

      await expect(provider.read('DATABASE_URL', 'auth-service')).resolves.toBe(
        'postgresql://localhost:5432/auth',
      );
    });

    it('should read the shared scope from the top-level secrets block', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');

      await expect(provider.read('REDIS_PASSWORD', 'shared')).resolves.toBe(
        'redis-password',
      );
    });

    it('should return null when the scope has no such key', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');

      await expect(
        provider.read('REDIS_PASSWORD', 'auth-service'),
      ).resolves.toBeNull();
      await expect(provider.read('NONEXISTENT', 'shared')).resolves.toBeNull();
      await expect(provider.read('KEY', 'unknown-service')).resolves.toBeNull();
    });

    it('should not return non-string entries of a section', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');

      await expect(
        provider.read('secrets', 'auth-service'),
      ).resolves.toBeNull();
    });

    it('should read the file again on every read', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      const readFile = fs.readFileSync as ReturnType<typeof rs.fn>;

      await provider.read('DATABASE_URL', 'auth-service');
      readFile.mockReturnValue(
        JSON.stringify({
          ...mockSecrets,
          'auth-service': { DATABASE_URL: 'postgresql://changed' },
        }),
      );

      await expect(provider.read('DATABASE_URL', 'auth-service')).resolves.toBe(
        'postgresql://changed',
      );
    });
  });

  describe('getName', () => {
    it('should return "local"', () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      expect(provider.getName()).toBe('local');
    });
  });

  describe('getSecretsFilePath', () => {
    it('should return the path to secrets file', () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      expect(provider.getSecretsFilePath()).toContain('.secrets.local.json');
    });
  });
});
