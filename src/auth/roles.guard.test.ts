import { describe, it, expect, beforeEach } from '@rstest/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import type { AuthenticatedRequest } from './auth-user.interface';

type Handler = () => void;

const createContext = (
  request: Partial<AuthenticatedRequest>,
  handler: Handler,
  controller: new () => unknown = class {},
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

const handlerWithRoles = (...roles: string[]): Handler => {
  const handler: Handler = () => undefined;
  Roles(...roles)(handler);
  return handler;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  describe('Without @Roles()', () => {
    it('should allow any request', () => {
      const handler: Handler = () => undefined;
      expect(guard.canActivate(createContext({}, handler))).toBe(true);
    });
  });

  describe('System role', () => {
    it('should allow a user with the system role', () => {
      const context = createContext(
        { authType: 'user', user: { id: 'u', systemRole: 'ADMIN' } },
        handlerWithRoles('ADMIN'),
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should fall back to the legacy role claim', () => {
      const context = createContext(
        { authType: 'user', user: { id: 'u', role: 'ADMIN' } },
        handlerWithRoles('ADMIN'),
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject a user without the role with 403', () => {
      const context = createContext(
        { authType: 'user', user: { id: 'u', systemRole: 'USER' } },
        handlerWithRoles('ADMIN'),
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('Custom roles', () => {
    it('should allow a user with a matching custom role', () => {
      const context = createContext(
        {
          authType: 'user',
          user: { id: 'u', systemRole: 'USER', roles: ['EDITOR'] },
        },
        handlerWithRoles('ADMIN', 'EDITOR'),
      );
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Callers without a user', () => {
    it('should reject a partner API key with 403', () => {
      const context = createContext(
        { authType: 'apiKey', apiKey: { id: 'k', consumer: 'acme' } },
        handlerWithRoles('ADMIN'),
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should reject an internal service call with 403', () => {
      const context = createContext(
        { authType: 'service', service: 'bff-service' },
        handlerWithRoles('ADMIN'),
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should reject an anonymous request with 403', () => {
      const context = createContext({}, handlerWithRoles('ADMIN'));
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should ignore a user object that AuthGuard did not classify as a user', () => {
      const context = createContext(
        { user: { id: 'u', systemRole: 'ADMIN' } },
        handlerWithRoles('ADMIN'),
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('Metadata placement', () => {
    it('should read roles from the controller class', () => {
      const handler: Handler = () => undefined;
      class AdminController {}
      Roles('ADMIN')(AdminController);
      const context = createContext(
        { authType: 'user', user: { id: 'u', systemRole: 'USER' } },
        handler,
        AdminController,
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should let handler roles override class roles', () => {
      class AdminController {}
      Roles('ADMIN')(AdminController);
      const context = createContext(
        { authType: 'user', user: { id: 'u', systemRole: 'USER' } },
        handlerWithRoles('USER'),
        AdminController,
      );
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
