import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const {
  mockCreateApp,
  mockApp,
  mockLoadEnvIfExists,
  mockLoadFrameworkConfig,
  mockReadPackageJson,
} = rs.hoisted(() => {
  const app = {
    listen: rs.fn().mockResolvedValue(undefined),
  };
  return {
    mockCreateApp: rs.fn().mockResolvedValue(app),
    mockApp: app,
    mockLoadEnvIfExists: rs.fn(),
    mockLoadFrameworkConfig: rs.fn().mockReturnValue({
      serviceName: 'test-service',
      port: 3000,
      globalPrefix: 'api',
    }),
    mockReadPackageJson: rs.fn().mockReturnValue({
      name: 'test-service',
      version: '1.0.0',
      description: 'Test service',
    }),
  };
});

rs.mock('./create-app', () => ({
  createApp: mockCreateApp,
}));

rs.mock('./load-env-if-exists', () => ({
  loadEnvIfExists: mockLoadEnvIfExists,
}));

rs.mock('../config/load-framework-config', () => ({
  loadFrameworkConfig: mockLoadFrameworkConfig,
}));

rs.mock('../utils/read-package-json', () => ({
  readPackageJson: mockReadPackageJson,
}));

rs.mock('../utils/title-case', () => ({
  titleCase: rs.fn((s: string) =>
    s
      .split('-')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  ),
}));

import { startApp } from './start-app';

describe('startApp', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load env before bootstrap', async () => {
    await startApp(class {});
    expect(mockLoadEnvIfExists).toHaveBeenCalled();
  });

  it('should set SERVICE_NAME from package.json', async () => {
    await startApp(class {});
    expect(process.env.SERVICE_NAME).toBe('test-service');
  });

  it('should load framework config with service name', async () => {
    await startApp(class {});
    expect(mockLoadFrameworkConfig).toHaveBeenCalledWith('test-service');
  });

  it('should create app with framework config', async () => {
    await startApp(class {});

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        port: 3000,
        globalPrefix: 'api',
      }),
    );
  });

  it('should use PORT env var when set', async () => {
    process.env.PORT = '8080';

    await startApp(class {});

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ port: 8080 }),
    );
  });

  it('should listen on 0.0.0.0', async () => {
    await startApp(class {});
    expect(mockApp.listen).toHaveBeenCalledWith(3000, '0.0.0.0');
  });

  it('should pass swagger overrides', async () => {
    const swagger = {
      title: 'Custom',
      description: 'Custom desc',
      version: '2.0.0',
    };

    await startApp(class {}, { swagger });

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        swagger: {
          title: 'Custom',
          description: 'Custom desc',
          version: '2.0.0',
        },
      }),
    );
  });

  it('should auto-generate swagger from package.json when not provided', async () => {
    await startApp(class {});

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        swagger: {
          title: 'Test Service',
          description: 'Test service',
          version: '1.0.0',
        },
      }),
    );
  });

  it('should pass jsonLimit and urlLimit overrides', async () => {
    await startApp(class {}, { jsonLimit: 5, urlLimit: 10 });

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jsonLimit: 5,
        urlLimit: 10,
      }),
    );
  });
});
