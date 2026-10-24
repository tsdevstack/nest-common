import { describe, it, expect, beforeEach, afterEach } from '@rstest/core';
import type { ExecutionContext } from '@nestjs/common';
import { getRateLimitScope } from './get-rate-limit-scope';

class AuthController {
  login(): void {}
  refreshToken(): void {}
}

class UserController {
  login(): void {}
}

const contextFor = (controller: object, handler: object): ExecutionContext =>
  ({
    getClass: () => controller,
    getHandler: () => handler,
  }) as unknown as ExecutionContext;

describe('getRateLimitScope', () => {
  const originalServiceName = process.env.SERVICE_NAME;

  beforeEach(() => {
    process.env.SERVICE_NAME = 'auth-service';
  });

  afterEach(() => {
    if (originalServiceName === undefined) {
      delete process.env.SERVICE_NAME;
    } else {
      process.env.SERVICE_NAME = originalServiceName;
    }
  });

  describe('Standard use cases', () => {
    it('should name the service, controller and handler', () => {
      expect(
        getRateLimitScope(
          contextFor(AuthController, AuthController.prototype.login),
        ),
      ).toBe('auth-service:AuthController.login');
    });

    it('should differ between handlers of one controller', () => {
      const login = getRateLimitScope(
        contextFor(AuthController, AuthController.prototype.login),
      );
      const refresh = getRateLimitScope(
        contextFor(AuthController, AuthController.prototype.refreshToken),
      );

      expect(login).not.toBe(refresh);
    });

    it('should differ between controllers with the same handler name', () => {
      const auth = getRateLimitScope(
        contextFor(AuthController, AuthController.prototype.login),
      );
      const user = getRateLimitScope(
        contextFor(UserController, UserController.prototype.login),
      );

      expect(auth).not.toBe(user);
    });

    it('should differ between services with the same controller', () => {
      const context = contextFor(
        UserController,
        UserController.prototype.login,
      );
      const inAuth = getRateLimitScope(context);
      process.env.SERVICE_NAME = 'bff-service';
      const inBff = getRateLimitScope(context);

      expect(inAuth).toBe('auth-service:UserController.login');
      expect(inBff).toBe('bff-service:UserController.login');
    });
  });

  describe('Edge cases', () => {
    it('should still return a scope without SERVICE_NAME', () => {
      delete process.env.SERVICE_NAME;

      expect(
        getRateLimitScope(
          contextFor(AuthController, AuthController.prototype.login),
        ),
      ).toBe('service:AuthController.login');
    });

    it('should still return a scope for nameless class and handler', () => {
      expect(getRateLimitScope(contextFor({}, {}))).toBe(
        'auth-service:controller.handler',
      );
    });
  });
});
