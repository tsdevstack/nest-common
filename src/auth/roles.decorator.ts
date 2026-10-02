import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { ROLES_KEY } from './roles.constants';
import { RolesGuard } from './roles.guard';

/**
 * Restricts a handler or controller to users holding at least one of the
 * given roles: a system role (`USER`, `ADMIN`) or a custom role.
 *
 * Applies `RolesGuard`, which runs after the global `AuthGuard`. Callers
 * without a matching role get 403.
 *
 * @param roles - Roles of which the user needs at least one
 *
 * @example
 * ```typescript
 * @Controller('admin/users')
 * @Roles('ADMIN')
 * export class AdminUsersController {}
 *
 * @Get('reports')
 * @Roles('ADMIN', 'BILLING')
 * reports() {}
 * ```
 */
export const Roles = (...roles: string[]): ReturnType<typeof applyDecorators> =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(RolesGuard));
