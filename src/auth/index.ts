/**
 * Authentication Module
 *
 * Provides authentication for tsdevstack applications including:
 * - Kong gateway JWT authentication
 * - Kong API key authentication
 * - Direct service-to-service API key authentication
 *
 * @packageDocumentation
 */

export { AuthModule } from './auth.module';
export { AuthGuard } from './auth.guard';
export { Public, IS_PUBLIC_KEY } from './public.decorator';
export { PartnerApi, IS_PARTNER_API_KEY } from './partner-api.decorator';
export { Partner } from './partner.decorator';
export type { KongUser, AuthenticatedRequest } from './auth-user.interface';
export { KongHeaders } from './auth-user.interface';