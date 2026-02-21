import { describe, it, expect } from '@rstest/core';
import { extractUserFromHeaders } from './extract-user-from-headers';

describe('extractUserFromHeaders', () => {
  it('should extract user ID from X-Consumer-ID header', () => {
    const headers = {
      'x-consumer-id': 'user-123',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
    });
  });

  it('should extract JWT claims from X-JWT-Claim-* headers', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-email': 'john@example.com',
      'x-jwt-claim-name': 'John Doe',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      email: 'john@example.com',
      name: 'John Doe',
    });
  });

  it('should convert kebab-case claim names to camelCase', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-tenant-id': 'tenant-456',
      'x-jwt-claim-is-verified': 'true',
      'x-jwt-claim-user-role-name': 'admin',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      tenantId: 'tenant-456',
      isVerified: true,
      userRoleName: 'admin',
    });
  });

  it('should parse array values from comma-separated strings', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-roles': 'USER,ADMIN,EDITOR',
      'x-jwt-claim-permissions': 'read, write, delete',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      roles: ['USER', 'ADMIN', 'EDITOR'],
      permissions: ['read', 'write', 'delete'],
    });
  });

  it('should parse numeric values', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-age': '25',
      'x-jwt-claim-score': '100',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      age: 25,
      score: 100,
    });
  });

  it('should parse boolean values', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-is-verified': 'true',
      'x-jwt-claim-is-active': 'false',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      isVerified: true,
      isActive: false,
    });
  });

  it('should handle mixed claim types', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-email': 'john@example.com',
      'x-jwt-claim-roles': 'USER,ADMIN',
      'x-jwt-claim-tenant-id': 'tenant-456',
      'x-jwt-claim-is-verified': 'true',
      'x-jwt-claim-login-count': '42',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      email: 'john@example.com',
      roles: ['USER', 'ADMIN'],
      tenantId: 'tenant-456',
      isVerified: true,
      loginCount: 42,
    });
  });

  it('should ignore headers that do not start with x-jwt-claim-', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-email': 'john@example.com',
      'content-type': 'application/json',
      authorization: 'Bearer token123',
      'x-custom-header': 'value',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      email: 'john@example.com',
    });
  });

  it('should handle empty claims (no X-JWT-Claim-* headers)', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'content-type': 'application/json',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
    });
  });

  it('should handle custom/dynamic claim names', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-custom-field-one': 'value1',
      'x-jwt-claim-another-custom-claim': 'value2',
      'x-jwt-claim-x': 'simple',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      customFieldOne: 'value1',
      anotherCustomClaim: 'value2',
      x: 'simple',
    });
  });

  it('should handle claims with special characters in values', () => {
    const headers = {
      'x-consumer-id': 'user-123',
      'x-jwt-claim-email': 'user+test@example.com',
      'x-jwt-claim-url': 'https://example.com/path',
    };

    const user = extractUserFromHeaders(headers);

    expect(user).toEqual({
      id: 'user-123',
      email: 'user+test@example.com',
      url: 'https://example.com/path',
    });
  });
});
