import { Module, Global } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { SecretsModule } from '../secrets/secrets.module';

/**
 * Kong Authentication Module.
 *
 * Provides the AuthGuard globally to all modules in the application.
 * Import this module once in your root AppModule to make AuthGuard
 * available throughout your application.
 *
 * ## Features
 * - Dynamic JWT claim extraction from Kong headers
 * - Service-to-service API key authentication
 * - @Public() decorator for public endpoints
 * - Network isolation security (trusts Kong headers only)
 *
 * @example
 * ```typescript
 * // app.module.ts
 * @Module({
 *   imports: [
 *     AuthModule,
 *     // ... other modules
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example Usage in controllers
 * ```typescript
 * @Controller('offers')
 * export class OffersController {
 *   @Get()
 *   @Public()
 *   list() {
 *     // Public endpoint
 *   }
 *
 *   @Post()
 *   @UseGuards(AuthGuard)
 *   create(@Request() req: AuthenticatedRequest) {
 *     const { id, email, roles } = req.user;
 *   }
 * }
 * ```
 */
@Global()
@Module({
  imports: [SecretsModule],
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}