import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const { mockCreate, mockApp, mockCreateSwaggerDocument, MockSwaggerModule } =
  rs.hoisted(() => {
    const app = {
      setGlobalPrefix: rs.fn(),
      enableVersioning: rs.fn(),
      use: rs.fn(),
      useGlobalPipes: rs.fn(),
      enableShutdownHooks: rs.fn(),
      listen: rs.fn().mockResolvedValue(undefined),
    };
    return {
      mockCreate: rs.fn().mockResolvedValue(app),
      mockApp: app,
      mockCreateSwaggerDocument: rs.fn().mockReturnValue({ paths: {} }),
      MockSwaggerModule: { setup: rs.fn() },
    };
  });

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

import { createApp } from './create-app';

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
