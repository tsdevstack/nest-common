import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const {
  mockExistsSync,
  mockReadFileSync,
  mockCreate,
  mockApp,
  mockDotenvConfig,
  mockCreateSwaggerDocument,
  mockLoadFrameworkConfig,
  mockReadPackageJson,
  MockSwaggerModule,
} = rs.hoisted(() => {
  const app = {
    setGlobalPrefix: rs.fn(),
    enableVersioning: rs.fn(),
    use: rs.fn(),
    useGlobalPipes: rs.fn(),
    enableShutdownHooks: rs.fn(),
    listen: rs.fn().mockResolvedValue(undefined),
  };
  return {
    mockExistsSync: rs.fn(),
    mockReadFileSync: rs.fn(),
    mockCreate: rs.fn().mockResolvedValue(app),
    mockApp: app,
    mockDotenvConfig: rs.fn(),
    mockCreateSwaggerDocument: rs.fn().mockReturnValue({ paths: {} }),
    mockLoadFrameworkConfig: rs.fn().mockReturnValue({
      serviceName: 'test-service',
      port: 3000,
      globalPrefix: 'api',
    }),
    mockReadPackageJson: rs.fn().mockReturnValue({
      name: 'test-service',
      version: '1.0.0',
      description: 'Test',
    }),
    MockSwaggerModule: { setup: rs.fn() },
  };
});

rs.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync },
}));

rs.mock('dotenv', () => ({
  default: { config: mockDotenvConfig },
}));

rs.mock('helmet', () => ({
  default: rs.fn().mockReturnValue(rs.fn()),
}));

rs.mock('compression', () => ({
  default: rs.fn().mockReturnValue(rs.fn()),
}));

rs.mock('express', () => ({
  default: {
    json: rs.fn().mockReturnValue(rs.fn()),
    urlencoded: rs.fn().mockReturnValue(rs.fn()),
  },
}));

rs.mock('@nestjs/core', () => ({
  NestFactory: { create: mockCreate },
  APP_INTERCEPTOR: 'APP_INTERCEPTOR',
  Reflector: class {},
}));

rs.mock('@nestjs/swagger', () => ({
  SwaggerModule: MockSwaggerModule,
}));

rs.mock('../open-api-docs/create-swagger-document', () => ({
  createSwaggerDocument: mockCreateSwaggerDocument,
}));

rs.mock('../config/load-framework-config', () => ({
  loadFrameworkConfig: mockLoadFrameworkConfig,
}));

rs.mock('../utils/package-json', () => ({
  readPackageJson: mockReadPackageJson,
  titleCase: rs.fn((s: string) => s),
}));

import { createApp, loadEnvIfExists } from './create-app';

describe('loadEnvIfExists', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
    process.cwd = rs.fn().mockReturnValue('/project/apps/service');
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  it('should skip if SECRETS_PROVIDER already set', () => {
    process.env.SECRETS_PROVIDER = 'gcp';

    loadEnvIfExists();

    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('should load .env with SECRETS_PROVIDER marker', () => {
    delete process.env.SECRETS_PROVIDER;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'SECRETS_PROVIDER=local\nREDIS_HOST=localhost',
    );

    loadEnvIfExists();

    expect(mockDotenvConfig).toHaveBeenCalled();
  });

  it('should skip .env without SECRETS_PROVIDER marker', () => {
    delete process.env.SECRETS_PROVIDER;
    // First .env found but no marker, then no more files
    mockExistsSync.mockReturnValueOnce(true).mockReturnValue(false);
    mockReadFileSync.mockReturnValue('DATABASE_URL=postgres://...');

    loadEnvIfExists();

    expect(mockDotenvConfig).not.toHaveBeenCalled();
  });

  it('should silently return when .env not found', () => {
    delete process.env.SECRETS_PROVIDER;
    mockExistsSync.mockReturnValue(false);

    expect(() => loadEnvIfExists()).not.toThrow();
  });
});

describe('createApp', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create a NestJS application', async () => {
    const MockModule = class {};
    await createApp(MockModule, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(mockCreate).toHaveBeenCalledWith(MockModule);
  });

  it('should set global prefix with excluded routes', async () => {
    await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(mockApp.setGlobalPrefix).toHaveBeenCalledWith('api', {
      exclude: ['health', 'health/ping', 'metrics'],
    });
  });

  it('should enable URI versioning', async () => {
    await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(mockApp.enableVersioning).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'v' }),
    );
  });

  it('should enable shutdown hooks by default', async () => {
    await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(mockApp.enableShutdownHooks).toHaveBeenCalled();
  });

  it('should skip shutdown hooks when disabled', async () => {
    await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
      enableShutdownHooks: false,
    });

    expect(mockApp.enableShutdownHooks).not.toHaveBeenCalled();
  });

  it('should setup Swagger in non-production', async () => {
    process.env.NODE_ENV = 'development';

    await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(mockCreateSwaggerDocument).toHaveBeenCalled();
    expect(MockSwaggerModule.setup).toHaveBeenCalled();
  });

  it('should skip Swagger in production', async () => {
    process.env.NODE_ENV = 'production';

    await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(mockCreateSwaggerDocument).not.toHaveBeenCalled();
  });

  it('should return the app instance', async () => {
    const app = await createApp(class {}, {
      port: 3000,
      globalPrefix: 'api',
      swagger: { title: 'Test', description: 'Test' },
    });

    expect(app).toBe(mockApp);
  });
});
