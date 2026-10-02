import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth-user.interface';
import { ROLES_KEY } from './roles.constants';
import { userHasAnyRole } from './utils/user-has-any-role';

/**
 * Enforces `@Roles()`: the logged-in user must hold at least one of the
 * listed roles, as its system role (`systemRole`, or the older `role` claim)
 * or among its custom `roles`. Anything else gets 403, including partner
 * API keys and internal service calls, which have no user.
 *
 * Roles come from the JWT, so a change applies at the user's next token
 * refresh. Sensitive actions should re-check the database.
 *
 * `@Roles()` already applies this guard. It runs after `AuthGuard` when
 * `AuthGuard` is registered globally (`APP_GUARD`), as the generated apps and
 * templates do: global guards run before controller and method guards. If
 * `AuthGuard` is instead applied with `@UseGuards()` and ends up after this
 * guard, `req.authType` is not set yet and the request fails closed (403).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authType === 'user' ? request.user : undefined;

    if (!userHasAnyRole(user, requiredRoles)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
