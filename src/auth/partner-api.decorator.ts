import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

/**
 * Metadata key for the @PartnerApi() decorator.
 */
export const IS_PARTNER_API_KEY = 'isPartnerApi';

/**
 * Decorator to mark routes as accessible via Partner API (requires API key).
 *
 * Routes marked with this decorator will be exposed under the /api prefix
 * in Kong Gateway and require a valid API key for access.
 *
 * This decorator is ADDITIVE, not exclusive:
 * - Can be used alone for partner-only access
 * - Can be combined with @ApiBearerAuth() for dual access (JWT + Partner API)
 *
 * @example Partner-only endpoint
 * ```typescript
 * @Controller('offers')
 * export class OffersController {
 *   @Get('current-plan')
 *   @PartnerApi()
 *   getCurrentPlan() {
 *     // Accessible only via /api/offers/current-plan with API key
 *   }
 * }
 * ```
 *
 * @example Dual-access endpoint (JWT + Partner API)
 * ```typescript
 * @Controller('data')
 * export class DataController {
 *   @Get('export')
 *   @ApiBearerAuth()
 *   @PartnerApi()
 *   exportData() {
 *     // Accessible via:
 *     // - /data/export with JWT token (for users)
 *     // - /api/data/export with API key (for partners)
 *   }
 * }
 * ```
 */
export const PartnerApi = () =>
  applyDecorators(
    SetMetadata(IS_PARTNER_API_KEY, true),
    ApiSecurity('api-key'),
  );