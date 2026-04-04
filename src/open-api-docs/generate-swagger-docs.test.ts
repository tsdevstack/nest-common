import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const {
  mockCreate,
  mockApp,
  mockLoadEnvIfExists,
  mockReadPackageJson,
  mockLoadFrameworkConfig,
  mockCreateSwaggerDocument,
} = rs.hoisted(() => {
  const app = {
    setGlobalPrefix: rs.fn(),
    enableVersioning: rs.fn(),
    close: rs.fn().mockResolvedValue(undefined),
  };
  return {
    mockCreate: rs.fn().mockResolvedValue(app),
    mockApp: app,
    mockLoadEnvIfExists: rs.fn(),
    mockReadPackageJson: rs.fn().mockReturnValue({
      name: 'auth-service',
      version: '1.0.0',
      description: 'Auth',
    }),
    mockLoadFrameworkConfig: rs.fn().mockReturnValue({
      serviceName: 'auth-service',
      globalPrefix: 'api',
    }),
    mockCreateSwaggerDocument: rs.fn().mockReturnValue({
      openapi: '3.0.0',
      paths: {},
    }),
  };
});

rs.mock('@nestjs/core', () => ({
  NestFactory: { create: mockCreate },
}));

rs.mock('../bootstrap/load-env-if-exists', () => ({
  loadEnvIfExists: mockLoadEnvIfExists,
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

rs.mock('../config/load-framework-config', () => ({
  loadFrameworkConfig: mockLoadFrameworkConfig,
}));

rs.mock('./create-swagger-document', () => ({
  createSwaggerDocument: mockCreateSwaggerDocument,
}));

import { generateSwaggerDocs } from './generate-swagger-docs';

describe('generateSwaggerDocs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load env', async () => {
    await generateSwaggerDocs(class {});
    expect(mockLoadEnvIfExists).toHaveBeenCalled();
  });

  it('should set SERVICE_NAME', async () => {
    await generateSwaggerDocs(class {});
    expect(process.env.SERVICE_NAME).toBe('auth-service');
  });

  it('should create NestJS app with preview mode', async () => {
    await generateSwaggerDocs(class {});

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        preview: true,
        abortOnError: false,
      }),
    );
  });

  it('should set global prefix from framework config', async () => {
    await generateSwaggerDocs(class {});
    expect(mockApp.setGlobalPrefix).toHaveBeenCalledWith('api');
  });

  it('should enable URI versioning', async () => {
    await generateSwaggerDocs(class {});
    expect(mockApp.enableVersioning).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'v' }),
    );
  });

  it('should generate swagger document with auto config', async () => {
    await generateSwaggerDocs(class {});

    expect(mockCreateSwaggerDocument).toHaveBeenCalledWith(
      mockApp,
      expect.objectContaining({
        title: 'Auth Service',
        description: 'Auth',
        version: '1.0.0',
        globalPrefix: 'api',
      }),
    );
  });

  it('should close app after generating docs', async () => {
    await generateSwaggerDocs(class {});
    expect(mockApp.close).toHaveBeenCalled();
  });

  it('should return the document', async () => {
    const result = await generateSwaggerDocs(class {});

    expect(result).toEqual({ openapi: '3.0.0', paths: {} });
  });
});
