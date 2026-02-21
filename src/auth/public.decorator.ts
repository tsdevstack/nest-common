import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for the @Public() decorator.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark routes as public (no authentication required).
 *
 * When applied to a controller method or class, KongAuthGuard will
 * skip authentication checks for those routes.
 *
 * @example Method-level (specific endpoint is public)
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Post('login')
 *   @Public()
 *   async login(@Body() dto: LoginDto) {
 *     // No authentication required for login
 *   }
 *
 *   @Get('profile')
 *   @UseGuards(KongAuthGuard)
 *   async getProfile(@Request() req: AuthenticatedRequest) {
 *     // Authentication required
 *     const user = req.user;
 *   }
 * }
 * ```
 *
 * @example Class-level (all endpoints are public)
 * ```typescript
 * @Controller('health')
 * @Public()
 * export class HealthController {
 *   @Get()
 *   check() {
 *     return { status: 'ok' };
 *   }
 * }
 * ```
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);