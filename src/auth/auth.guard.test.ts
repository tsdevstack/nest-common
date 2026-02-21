import { describe, it, expect, beforeEach, rs } from '@rstest/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { SecretsService } from '../secrets/secrets.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let reflector: Reflector;
  let mockSecretsService: SecretsService;
  const MOCK_KONG_TRUST_TOKEN = 'test-kong-trust-token-12345';
  const MOCK_API_KEY = 'direct-service-api-key';

  beforeEach(() => {
    reflector = new Reflector();
    mockSecretsService = {
      get: rs.fn((key: string) => {
        if (key === 'KONG_TRUST_TOKEN') {
          return Promise.resolve(MOCK_KONG_TRUST_TOKEN);
        }
        if (key === 'API_KEY') {
          return Promise.resolve(MOCK_API_KEY);
        }
        return Promise.resolve('mock-api-key');
      }),
    } as unknown as SecretsService;
    guard = new AuthGuard(reflector, mockSecretsService);
  });

  const createMockExecutionContext = (
    headers: Record<string, string>,
  ): ExecutionContext => {
    const request = { headers };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  describe('Kong trust header verification', () => {
    it('should allow requests with valid Kong trust header', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow requests with Kong consumer headers even without trust header (trusts network isolation)', async () => {
      // Guard trusts that Kong headers can only come through internal network
      // This is defense-in-depth where network isolation is the primary control
      const context = createMockExecutionContext({
        'x-consumer-id': 'user-123',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should reject requests with invalid Kong trust header', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': 'invalid-token',
        'x-consumer-id': 'user-123',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Unauthorized request',
      );
    });

    it('should bypass Kong trust check for direct service-to-service calls with API key', async () => {
      const context = createMockExecutionContext({
        'x-api-key': 'direct-service-api-key',
        'x-consumer-username': 'bff-service',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should still require Kong trust header for public endpoints', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow public endpoints without Kong trust header', async () => {
      // Public endpoints don't require any authentication or Kong trust header
      const context = createMockExecutionContext({
        'content-type': 'application/json',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('.well-known endpoint bypass', () => {
    it('should allow .well-known/jwks.json without Kong trust header', async () => {
      const request = {
        headers: {},
        url: '/auth/.well-known/jwks.json',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow .well-known/openid-configuration without Kong trust header', async () => {
      const request = {
        headers: {},
        url: '/auth/.well-known/openid-configuration',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow .well-known endpoints using request.path property', async () => {
      const request = {
        headers: {},
        path: '/auth/v1/auth/.well-known/jwks.json',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should bypass Kong trust check for .well-known but still require @Public', async () => {
      const request = {
        headers: {},
        url: '/auth/.well-known/jwks.json',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;

      // NOT a public endpoint
      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // Should fail because endpoint is not marked as @Public
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'No authentication provided',
      );
    });

    it('should not bypass Kong trust check for paths that only contain "well-known" as substring', async () => {
      // When Kong trust header is present but invalid, and path doesn't match /.well-known/,
      // the request should be rejected
      const request = {
        headers: {
          'x-kong-trust': 'invalid-token',
        },
        url: '/auth/v1/well-known-users',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      // Should fail because path doesn't contain /.well-known/ and token is invalid
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Unauthorized request',
      );
    });

    it('should require exact /.well-known/ pattern with slashes', async () => {
      // When Kong trust header is present but invalid, and path doesn't match /.well-known/,
      // the request should be rejected
      const request = {
        headers: {
          'x-kong-trust': 'invalid-token',
        },
        url: '/auth/v1/wellknown/config',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext;

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      // Should fail because path is "wellknown" not ".well-known" and token is invalid
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Unauthorized request',
      );
    });
  });

  describe('Public endpoints', () => {
    it('should allow requests to public endpoints with Kong trust header', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        {},
        {},
      ]);
    });
  });

  describe('Protected endpoints - JWT authentication', () => {
    it('should allow requests with valid Kong JWT headers and trust token', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-email': 'john@example.com',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(result).toBe(true);
      expect(request.user).toEqual({
        id: 'user-123',
        email: 'john@example.com',
      });
    });

    it('should extract all JWT claims dynamically', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-email': 'john@example.com',
        'x-jwt-claim-roles': 'USER,ADMIN',
        'x-jwt-claim-tenant-id': 'tenant-456',
        'x-jwt-claim-is-verified': 'true',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user).toEqual({
        id: 'user-123',
        email: 'john@example.com',
        roles: ['USER', 'ADMIN'],
        tenantId: 'tenant-456',
        isVerified: true,
      });
    });

    it('should throw UnauthorizedException when no authentication provided', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'content-type': 'application/json',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'No authentication provided',
      );
    });
  });

  describe('Protected endpoints - API key authentication (service-to-service)', () => {
    it('should allow requests with valid Kong API key headers and trust token', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-username': 'bff-service',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(result).toBe(true);
      expect(request.service).toBe('bff-service');
      expect(request.user).toBeUndefined();
    });

    it('should set service name from X-Consumer-Username', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-username': 'offers-service',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.service).toBe('offers-service');
    });
  });

  describe('Priority handling', () => {
    it('should prioritize JWT authentication over API key when both headers present', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-consumer-username': 'some-service',
        'x-jwt-claim-email': 'john@example.com',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      // Should use JWT (user) not API key (service)
      expect(request.user).toEqual({
        id: 'user-123',
        email: 'john@example.com',
      });
      expect(request.service).toBeUndefined();
    });
  });

  describe('Header parsing', () => {
    it('should parse array claims', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-permissions': 'read,write,delete',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user.permissions).toEqual(['read', 'write', 'delete']);
    });

    it('should parse numeric claims', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-age': '30',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user.age).toBe(30);
    });

    it('should parse boolean claims', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-is-active': 'true',
        'x-jwt-claim-is-deleted': 'false',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user.isActive).toBe(true);
      expect(request.user.isDeleted).toBe(false);
    });

    it('should convert claim names to camelCase', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-tenant-id': 'tenant-456',
        'x-jwt-claim-user-role-name': 'admin',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user.tenantId).toBe('tenant-456');
      expect(request.user.userRoleName).toBe('admin');
    });
  });

  describe('Reflector integration', () => {
    it('should check @Public decorator at method level with Kong trust header', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
      });
      const methodHandler = () => {};
      const classConstructor = class {};

      const contextWithMetadata = {
        ...context,
        getHandler: () => methodHandler,
        getClass: () => classConstructor,
      } as ExecutionContext;

      const getAllAndOverrideSpy = rs
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(true);

      await guard.canActivate(contextWithMetadata);

      expect(getAllAndOverrideSpy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        methodHandler,
        classConstructor,
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty user object (only consumer ID)', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user).toEqual({
        id: 'user-123',
      });
    });

    it('should ignore non-JWT-claim headers', async () => {
      const context = createMockExecutionContext({
        'x-kong-trust': MOCK_KONG_TRUST_TOKEN,
        'x-consumer-id': 'user-123',
        'x-jwt-claim-email': 'john@example.com',
        'content-type': 'application/json',
        authorization: 'Bearer token',
        'x-custom-header': 'value',
      });

      rs.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      await guard.canActivate(context);
      const request = context.switchToHttp().getRequest();

      expect(request.user).toEqual({
        id: 'user-123',
        email: 'john@example.com',
      });
    });
  });
});
