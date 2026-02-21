import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const { mockExistsSync, mockReadFileSync } = rs.hoisted(() => ({
  mockExistsSync: rs.fn(),
  mockReadFileSync: rs.fn(),
}));

rs.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { loadFrameworkConfig } from './load-framework-config';

describe('loadFrameworkConfig', () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    rs.clearAllMocks();
    process.cwd = rs.fn().mockReturnValue('/project/apps/auth-service');
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe('Config file discovery', () => {
    it('should throw if config file not found', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => loadFrameworkConfig('auth-service')).toThrow(
        'Framework configuration not found',
      );
    });

    it('should find config in current directory', () => {
      mockExistsSync.mockImplementation(
        (p: string) =>
          p.endsWith('.tsdevstack/config.json') &&
          p.startsWith('/project/apps/auth-service'),
      );
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          services: [
            {
              name: 'auth-service',
              type: 'nestjs',
              port: 3001,
              globalPrefix: 'api',
              hasDatabase: true,
            },
          ],
        }),
      );

      const result = loadFrameworkConfig('auth-service');
      expect(result.serviceName).toBe('auth-service');
    });

    it('should walk up directories to find config', () => {
      // Not found in current or apps dir, found in project root
      mockExistsSync.mockImplementation(
        (p: string) => p === '/project/.tsdevstack/config.json',
      );
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          services: [
            {
              name: 'auth-service',
              type: 'nestjs',
              port: 3001,
              globalPrefix: 'api',
              hasDatabase: true,
            },
          ],
        }),
      );

      const result = loadFrameworkConfig('auth-service');
      expect(result.serviceName).toBe('auth-service');
    });
  });

  describe('Config parsing', () => {
    it('should throw on invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json');

      expect(() => loadFrameworkConfig('auth-service')).toThrow(
        'Failed to read framework configuration',
      );
    });

    it('should throw if services array is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ project: {} }));

      expect(() => loadFrameworkConfig('auth-service')).toThrow(
        'Expected "services" array',
      );
    });

    it('should throw if services is not an array', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ services: 'not-array' }),
      );

      expect(() => loadFrameworkConfig('auth-service')).toThrow(
        'Expected "services" array',
      );
    });
  });

  describe('Service lookup', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          services: [
            {
              name: 'auth-service',
              type: 'nestjs',
              port: 3001,
              globalPrefix: 'api',
              hasDatabase: true,
              databaseType: 'postgresql',
            },
            {
              name: 'bff-service',
              type: 'nestjs',
              port: 3002,
              globalPrefix: 'api',
              hasDatabase: false,
            },
          ],
        }),
      );
    });

    it('should return correct service config', () => {
      const result = loadFrameworkConfig('auth-service');

      expect(result).toEqual({
        serviceName: 'auth-service',
        type: 'nestjs',
        port: 3001,
        globalPrefix: 'api',
        hasDatabase: true,
        databaseType: 'postgresql',
      });
    });

    it('should find different services', () => {
      const result = loadFrameworkConfig('bff-service');
      expect(result.serviceName).toBe('bff-service');
      expect(result.port).toBe(3002);
    });

    it('should throw if service not found with available services list', () => {
      expect(() => loadFrameworkConfig('unknown-service')).toThrow(
        'Service "unknown-service" not found',
      );
      expect(() => loadFrameworkConfig('unknown-service')).toThrow(
        'Available services: auth-service, bff-service',
      );
    });
  });
});
