import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

// Mock fs module
rs.mock('fs', () => ({
  existsSync: rs.fn(),
  readFileSync: rs.fn(),
  writeFileSync: rs.fn(),
}));

// Mock child_process
rs.mock('child_process', () => ({
  exec: rs.fn(),
}));

// Mock util
rs.mock('util', () => ({
  promisify: rs.fn((fn) => fn),
}));

import * as fs from 'fs';
import { exec } from 'child_process';
import { LocalSecretsProvider } from './local.provider';

describe('LocalSecretsProvider', () => {
  const mockSecrets = {
    'auth-service': {
      DATABASE_URL: 'postgresql://localhost:5432/auth',
      JWT_SECRET: 'auth-jwt-secret',
    },
    shared: {
      REDIS_PASSWORD: 'redis-password',
      API_KEY: 'shared-api-key',
    },
    secrets: {
      NODE_ENV: 'development',
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

    it('should use custom cache TTL when provided', () => {
      const provider = new LocalSecretsProvider('.secrets.local.json', 30000);
      expect(provider.getName()).toBe('local');
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

  describe('get', () => {
    it('should get service-scoped secret', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('auth-service');

      const value = await provider.get('DATABASE_URL');
      expect(value).toBe('postgresql://localhost:5432/auth');
    });

    it('should fall back to top-level secrets', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('auth-service');

      const value = await provider.get('NODE_ENV');
      expect(value).toBe('development');
    });

    it('should throw error when secret not found', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('auth-service');

      await expect(provider.get('NONEXISTENT')).rejects.toThrow(
        'Secret "NONEXISTENT" not found',
      );
    });

    it('should use cache on subsequent calls', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('auth-service');

      await provider.get('DATABASE_URL');
      const readCount = (fs.readFileSync as ReturnType<typeof rs.fn>).mock.calls
        .length;

      await provider.get('DATABASE_URL');
      // Should not read file again due to cache
      expect(
        (fs.readFileSync as ReturnType<typeof rs.fn>).mock.calls.length,
      ).toBe(readCount);
    });

    it('should reload from file after cache expires', async () => {
      // Use very short TTL
      const provider = new LocalSecretsProvider('.secrets.local.json', 1);
      provider.setServiceName('auth-service');

      await provider.get('DATABASE_URL');
      const initialReadCount = (fs.readFileSync as ReturnType<typeof rs.fn>)
        .mock.calls.length;

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 5));

      await provider.get('DATABASE_URL');
      // Should read file again after cache expires
      expect(
        (fs.readFileSync as ReturnType<typeof rs.fn>).mock.calls.length,
      ).toBeGreaterThan(initialReadCount);
    });
  });

  describe('getAll', () => {
    it('should return all secrets for a service', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      const secrets = await provider.getAll('auth-service');

      expect(secrets).toEqual({
        DATABASE_URL: 'postgresql://localhost:5432/auth',
        JWT_SECRET: 'auth-jwt-secret',
      });
    });

    it('should return empty object for unknown service', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      const secrets = await provider.getAll('unknown-service');

      expect(secrets).toEqual({});
    });

    it('should throw error for invalid service config', async () => {
      const invalidSecrets = {
        'bad-service': 'not an object',
      };
      (fs.readFileSync as ReturnType<typeof rs.fn>).mockReturnValue(
        JSON.stringify(invalidSecrets),
      );

      const provider = new LocalSecretsProvider('.secrets.local.json');
      await expect(provider.getAll('bad-service')).rejects.toThrow(
        'Invalid secrets format',
      );
    });
  });

  describe('set', () => {
    it('should update .secrets.user.json and regenerate', async () => {
      (exec as unknown as ReturnType<typeof rs.fn>).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
          return Promise.resolve({ stdout: '', stderr: '' });
        },
      );

      const provider = new LocalSecretsProvider('.secrets.local.json');
      await provider.set('NEW_KEY', 'new-value');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should create secrets section if not exists', async () => {
      // Use mockImplementation for complex sequencing
      let existsSyncCallCount = 0;
      (fs.existsSync as ReturnType<typeof rs.fn>).mockImplementation(
        (filePath: string) => {
          existsSyncCallCount++;
          // First call is for secrets.local.json (constructor) - return true
          // Second call is for secrets.user.json (set method) - return false
          if (existsSyncCallCount === 1) return true;
          if (filePath.includes('.secrets.user.json')) return false;
          return true;
        },
      );
      (exec as unknown as ReturnType<typeof rs.fn>).mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
          return Promise.resolve({ stdout: '', stderr: '' });
        },
      );

      const provider = new LocalSecretsProvider('.secrets.local.json');
      await provider.set('NEW_KEY', 'new-value');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"secrets"'),
        'utf-8',
      );
    });
  });

  describe('delete', () => {
    it('should throw error if user secrets file not found', async () => {
      // Use mockImplementation for complex sequencing
      let existsSyncCallCount = 0;
      (fs.existsSync as ReturnType<typeof rs.fn>).mockImplementation(
        (path: string) => {
          existsSyncCallCount++;
          // First call is for secrets.local.json (constructor) - return true
          // Second call is for secrets.user.json (delete method) - return false
          if (existsSyncCallCount === 1) return true;
          if (path.includes('.secrets.user.json')) return false;
          return true;
        },
      );

      const provider = new LocalSecretsProvider('.secrets.local.json');
      await expect(provider.delete('SOME_KEY')).rejects.toThrow(
        '.secrets.user.json not found',
      );
    });

    it('should throw error if secret not found in user secrets', async () => {
      const userSecrets = { secrets: { OTHER_KEY: 'value' } };
      (fs.existsSync as ReturnType<typeof rs.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof rs.fn>)
        .mockReturnValueOnce(JSON.stringify(mockSecrets)) // for constructor
        .mockReturnValueOnce(JSON.stringify(userSecrets)); // for delete

      const provider = new LocalSecretsProvider('.secrets.local.json');
      await expect(provider.delete('NONEXISTENT')).rejects.toThrow(
        'Secret "NONEXISTENT" not found in .secrets.user.json',
      );
    });
  });

  describe('clearCache', () => {
    it('should clear all cached secrets', async () => {
      const provider = new LocalSecretsProvider('.secrets.local.json');
      provider.setServiceName('auth-service');

      await provider.get('DATABASE_URL');
      provider.clearCache();

      // After clearing, should read from file again
      const readCountBefore = (fs.readFileSync as ReturnType<typeof rs.fn>).mock
        .calls.length;
      await provider.get('DATABASE_URL');
      expect(
        (fs.readFileSync as ReturnType<typeof rs.fn>).mock.calls.length,
      ).toBeGreaterThan(readCountBefore);
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
