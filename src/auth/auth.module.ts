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
 * - Kong trust token verified before any identity header is read
 * - Users from the OIDC plugin's X-Userinfo, partner API keys from the key plugin
 * - Service-to-service API key authentication
 * - @Public() and @PartnerApi() enforcement
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
