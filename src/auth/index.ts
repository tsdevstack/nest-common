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
export { ApiKey } from './api-key.decorator';
export { Roles } from './roles.decorator';
export { RolesGuard } from './roles.guard';
export { ROLES_KEY } from './roles.constants';
export type {
  KongUser,
  AuthenticatedRequest,
  AuthenticatedApiKey,
  AuthType,
} from './auth-user.interface';
export { KongHeaders } from './auth-user.interface';
