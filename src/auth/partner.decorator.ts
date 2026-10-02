import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth-user.interface';
import { getRequestPartner } from './utils/get-request-partner';

/**
 * Injects the consumer of the partner API key that authenticated the request
 * (`req.apiKey.consumer`, set by `AuthGuard` from the gateway's
 * `X-Api-Key-Consumer`).
 *
 * @returns The consumer name, for example `acme-corp`, or undefined when the
 *   request was not made with a partner API key
 *
 * @example
 * ```typescript
 * @Controller('webhooks')
 * export class WebhooksController {
 *   @PartnerApi()
 *   @Post('data')
 *   async receiveData(@Partner() partner: string) {
 *     this.logger.info('Partner API call', { partner });
 *   }
 * }
 * ```
 *
 * @example Dual access (JWT + partner)
 * ```typescript
 * @ApiBearerAuth()
 * @PartnerApi()
 * @Get('data')
 * async exportData(
 *   @Req() req: AuthenticatedRequest,
 *   @Partner() partner?: string,
 * ) {
 *   if (partner) {
 *     // /api/exports/data with an API key
 *   } else {
 *     // /exports/data with a JWT: req.user is set
 *   }
 * }
 * ```
 */
export const Partner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    getRequestPartner(ctx.switchToHttp().getRequest<AuthenticatedRequest>()),
);
