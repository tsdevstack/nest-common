import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const {
  mockBuild,
  mockSetTitle,
  mockSetDescription,
  mockSetVersion,
  mockAddBearerAuth,
  mockAddApiKey,
  mockAddTag,
  mockCreateDocument,
} = rs.hoisted(() => ({
  mockBuild: rs.fn().mockReturnValue({ openapi: '3.0.0' }),
  mockSetTitle: rs.fn().mockReturnThis(),
  mockSetDescription: rs.fn().mockReturnThis(),
  mockSetVersion: rs.fn().mockReturnThis(),
  mockAddBearerAuth: rs.fn().mockReturnThis(),
  mockAddApiKey: rs.fn().mockReturnThis(),
  mockAddTag: rs.fn().mockReturnThis(),
  mockCreateDocument: rs.fn().mockReturnValue({ paths: {} }),
}));

rs.mock('@nestjs/swagger', () => ({
  DocumentBuilder: class {
    setTitle = mockSetTitle;
    setDescription = mockSetDescription;
    setVersion = mockSetVersion;
    addBearerAuth = mockAddBearerAuth;
    addApiKey = mockAddApiKey;
    addTag = mockAddTag;
    build = mockBuild;
  },
  SwaggerModule: {
    createDocument: mockCreateDocument,
  },
}));

import { createSwaggerDocument } from './create-swagger-document';

describe('createSwaggerDocument', () => {
  const mockApp = {} as never;

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should set title from config', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
    });

    expect(mockSetTitle).toHaveBeenCalledWith('My Service');
  });

  it('should set description from config', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'Service description',
    });

    expect(mockSetDescription).toHaveBeenCalledWith('Service description');
  });

  it('should default version to 1.0.0', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
    });

    expect(mockSetVersion).toHaveBeenCalledWith('1.0.0');
  });

  it('should use custom version when provided', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
      version: '2.3.0',
    });

    expect(mockSetVersion).toHaveBeenCalledWith('2.3.0');
  });

  it('should add bearer auth scheme', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
    });

    expect(mockAddBearerAuth).toHaveBeenCalledWith(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    );
  });

  it('should add api-key auth scheme', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
    });

    expect(mockAddApiKey).toHaveBeenCalledWith(
      { type: 'apiKey', in: 'header', name: 'x-api-key' },
      'api-key',
    );
  });

  it('should add tags when provided', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
      tags: ['auth', 'users'],
    });

    expect(mockAddTag).toHaveBeenCalledWith('auth');
    expect(mockAddTag).toHaveBeenCalledWith('users');
  });

  it('should not add tags when not provided', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
    });

    expect(mockAddTag).not.toHaveBeenCalled();
  });

  it('should call SwaggerModule.createDocument', () => {
    createSwaggerDocument(mockApp, {
      title: 'My Service',
      description: 'A service',
    });

    expect(mockCreateDocument).toHaveBeenCalledWith(mockApp, {
      openapi: '3.0.0',
    });
  });
});
